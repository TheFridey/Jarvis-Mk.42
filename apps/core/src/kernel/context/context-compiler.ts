/**
 * Context Compiler (KERNEL_CONSTITUTION.md #5, COGNITION_MODEL.md §4).
 *
 * Gathers candidate items from the authoritative state slices, recent events,
 * registered capability names, AND — from MK.46 — the two knowledge subsystems:
 * ATLAS (entities, relationships, facts, observations, conflicts, causal
 * hypotheses) and MNEMOSYNE (episodes, semantic, procedures, preferences). It is
 * the ONLY place the two are fused (ADR-0020): `AtlasQuery` and `MemoryRecall`
 * are each queried directly here, never each other.
 *
 * Every item carries provenance + privacyClass + sourceType + (where the source
 * has one) confidence. The package is ranked, privacy-filtered against
 * `req.maxPrivacyClass`, deduped, budget-truncated, and versioned. It computes
 * `maxPrivacyClass` over the kept items so cognition can route model locality.
 *
 * It NEVER calls a model and NEVER causes an effect.
 */
import { createHash } from 'node:crypto';
import { recentEventRelevant } from './event-relevance.ts';
import {
  EventNames,
  type AtlasQuery,
  type ContextItem,
  type ContextItemKind,
  type ContextPackage,
  type ContextRequest,
  type ContextSourceType,
  type MemoryRecall,
  type PrivacyClass,
  type StateSliceKey,
} from '@jarvis/contracts';
import type { Clock } from '../../runtime/clock.ts';
import type { IdGen } from '../../runtime/ids.ts';
import type { EventManager } from '../event-fabric/event-manager.ts';
import type { EventStore } from '../event-fabric/event-store.ts';
import type { StateManager } from '../state/state-manager.ts';
import type { AtlasStore } from '../atlas/stores.ts';
import { buildPackage, scoreItem, type RankInput } from './ranking.ts';
import { canonicalJson } from '../../runtime/canonical-json.ts';
import { withSpan } from '@jarvis/telemetry';

const PRIVACY_ORDER: PrivacyClass[] = ['PUBLIC', 'INTERNAL', 'SENSITIVE', 'RESTRICTED'];

/** Highest privacy class among items, PUBLIC for an empty set. */
export function maxPrivacyOf(items: { privacyClass: PrivacyClass }[]): PrivacyClass {
  let idx = 0;
  for (const it of items) idx = Math.max(idx, PRIVACY_ORDER.indexOf(it.privacyClass));
  return PRIVACY_ORDER[idx]!;
}

const SLICE_TO_KIND: Partial<Record<StateSliceKey, ContextItemKind>> = {
  active_objective: 'active_objective',
  active_workspace: 'active_workspace',
  selected_object: 'selected_object',
  cursor_target: 'cursor_target',
  gesture_target: 'gesture_target',
  location: 'location',
  presence: 'presence',
  active_context: 'working_memory',
};

/** Optional MK.46 knowledge sources. Absent => the compiler runs exactly as the
 *  MK.43 scaffold did (kernel state + events + capabilities only). */
export interface KnowledgeSources {
  atlasQuery: AtlasQuery;
  atlasStore: AtlasStore;
  recall: MemoryRecall;
  principalId: () => string;
  activeObjectiveIds: () => Promise<string[]>;
}

export interface ContextCompilerDeps {
  perception?:(ref:string,principalId:string)=>Array<{kind:ContextItemKind;content:unknown;privacyClass:PrivacyClass;observedAt:string;confidence?:number}>;
  state: StateManager;
  eventStore: EventStore;
  events: EventManager;
  clock: Clock;
  ids: IdGen;
  /** Names of registered capabilities, injected so the compiler stays decoupled. */
  availableCapabilities: () => string[];
  knowledge?: KnowledgeSources;
}

function hash(v: unknown): string {
  return createHash('sha256').update(canonicalJson(v)).digest('hex').slice(0, 16);
}

export class ContextCompiler {
  private version = 0;

  constructor(private readonly deps: ContextCompilerDeps) {}

  async compile(req: ContextRequest): Promise<ContextPackage> {
    return withSpan('context.compile', {
      'jarvis.correlation_id': req.correlationId,
      'jarvis.context.intent_class': req.intentClass,
      'jarvis.context.budget_units': req.budgetUnits,
    }, async (span) => {
      const result = await this.compileInner(req);
      span.setAttribute('jarvis.context.used_units', result.budget.usedUnits);
      span.setAttribute('jarvis.context.truncated', result.budget.truncated);
      return result;
    });
  }

  private async compileInner(req: ContextRequest): Promise<ContextPackage> {
    const now = this.deps.clock.epochMs();
    const nowIso = this.deps.clock.nowIso();
    const candidates: RankInput[] = [];
    const unknowns: string[] = [];
    const freshness: { atlasAsOf?: string; memoryAsOf?: string } = {};
    if(req.perceptionRef){if(!req.principalId||!this.deps.perception)throw new Error('perception context binding required');for(const item of this.deps.perception(req.perceptionRef,req.principalId)){candidates.push(this.mkItem(item.kind,`selected perception: ${item.kind}`,item.content,item.privacyClass,{ageMs:now-Date.parse(item.observedAt),sizeUnits:estimateUnits(item.content),sourceType:'derivation',confidence:item.confidence,provenance:{method:'sensor',producedBy:'local-perception',producedOn:'workstation',producedAt:item.observedAt,correlationId:req.correlationId,derivedFromUntrusted:true}}));}}

    // 1. authoritative state slices
    const view = await this.deps.state.view();
    for (const [key, kind] of Object.entries(SLICE_TO_KIND) as [StateSliceKey, ContextItemKind][]) {
      const slice = view.slices[key];
      if (isEmptyValue(slice.value)) {
        unknowns.push(`no ${key}`);
        continue;
      }
      candidates.push(this.mkItem(kind, `${key}: ${summarise(slice.value)}`, slice.value, 'INTERNAL', {
        ageMs: now - Date.parse(slice.updatedAt), sizeUnits: estimateUnits(slice.value), sourceType: 'kernel_state',
      }));
    }

    // 2. recent events (bounded)
    for (const e of await this.deps.eventStore.readRecent(20)) {
      if(!recentEventRelevant(e.type,req.intent))continue;
      candidates.push(this.mkItem('recent_event', `${e.type} @ ${e.time}`, { type: e.type, subject: e.subject }, e.privacyClass, {
        ageMs: now - Date.parse(e.time), sizeUnits: 8, sourceType: 'event_log',
      }));
    }

    // 3. available capabilities (names only)
    for (const cap of this.deps.availableCapabilities()) {
      candidates.push(this.mkItem('available_capability', `capability: ${cap}`, { id: cap }, 'PUBLIC', {
        sizeUnits: 3, sourceType: 'capability_registry',
      }));
    }

    // 4. ATLAS — entities, relationships, facts, observations, conflicts, causal
    // 5. MNEMOSYNE — episodes, semantic, procedures, preferences
    if (this.deps.knowledge) {
      const objectiveIds = await this.deps.knowledge.activeObjectiveIds().catch(() => [] as string[]);
      const entityIds = await this.addAtlasItems(req, candidates, unknowns, nowIso, now);
      freshness.atlasAsOf = nowIso;
      await this.addMemoryItems(req, candidates, entityIds, objectiveIds, now);
      freshness.memoryAsOf = nowIso;
    }

    // score
    const scored: ContextItem[] = candidates.map((c) => ({ ...c, relevance: scoreItem(c, req) }));
    const result = buildPackage(scored, req);
    if(req.perceptionRef&&candidates.filter(c=>c.provenance.producedBy==='local-perception').some(c=>!result.kept.some(item=>item.contentHash===c.contentHash)))throw new Error('required perception context exceeds privacy ceiling or budget');

    this.version++;
    const pkg: ContextPackage = {
      id: this.deps.ids.ulid(),
      version: this.version,
      request: req,
      compiledAt: nowIso,
      items: result.kept,
      budget: {
        limitUnits: req.budgetUnits,
        usedUnits: result.usedUnits,
        truncated: result.truncated,
        omitted: result.omitted,
      },
      unknowns,
      filtered: { byPrivacy: result.byPrivacy, byDedupe: result.byDedupe },
      maxPrivacyClass: maxPrivacyOf(result.kept),
      ...(freshness.atlasAsOf || freshness.memoryAsOf ? { freshness } : {}),
    };

    await this.deps.events
      .emit({
        type: EventNames.ContextCompiled,
        retentionClass: 'DIAGNOSTIC',
        privacyClass: 'INTERNAL',
        subject: { kind: 'context', id: pkg.id },
        actor: { kind: 'system', id: 'context-compiler' },
        correlationId: req.correlationId,
        causationId: req.correlationId,
        principalId: 'system',
        payload: {
          contextId: pkg.id,
          version: pkg.version,
          intentClass: req.intentClass,
          itemCount: pkg.items.length,
          usedUnits: result.usedUnits,
          truncated: result.truncated,
        },
      })
      .catch(() => undefined);

    return pkg;
  }

  /** Returns the entity ids found, for the MNEMOSYNE entity-overlap factor. */
  private async addAtlasItems(
    req: ContextRequest, out: RankInput[], unknowns: string[], nowIso: string, nowMs: number,
  ): Promise<string[]> {
    const k = this.deps.knowledge!;
    const principalId = k.principalId();
    const entities = await k.atlasStore.searchEntities(principalId, req.intent, 5).catch(() => []);
    const entityIds: string[] = [];

    for (const ent of entities) {
      entityIds.push(ent.id);
      out.push(this.mkItem('world_entity', `entity: ${ent.canonicalName} (${ent.type})`, {
        id: ent.id, type: ent.type, canonicalName: ent.canonicalName, aliases: ent.aliases,
      }, ent.privacyClass, { sizeUnits: 6, sourceType: 'atlas', ageMs: nowMs - Date.parse(ent.updatedAt) }));

      const believed = await k.atlasQuery.currentlyBelieved(ent.id);
      if (believed.known) {
        for (const f of believed.value.facts.slice(0, 6)) {
          out.push(this.mkItem('world_fact', `${ent.canonicalName}.${f.attribute} = ${summarise(f.value)} [${f.epistemicStatus}]`, {
            factId: f.id, subjectEntityId: f.subjectEntityId, attribute: f.attribute, predicate: f.predicate,
            value: f.value, epistemicStatus: f.epistemicStatus, validFrom: f.validFrom, validTo: f.validTo,
            contradictionOf: f.contradictionOf,
          }, f.privacyClass, {
            sizeUnits: 10, sourceType: 'atlas', confidence: f.confidence,
            ageMs: nowMs - Date.parse(f.validFrom), provenance: f.provenance,
          }));
        }
      } else {
        unknowns.push(`no active facts for ${ent.canonicalName}`);
      }

      const rels = await k.atlasQuery.relationships(ent.id, { at: nowIso });
      for (const r of rels.relationships.slice(0, 5)) {
        out.push(this.mkItem('world_relationship', `${r.fromEntityId} -${r.type}-> ${r.toEntityId}`, {
          id: r.id, from: r.fromEntityId, to: r.toEntityId, type: r.type, validFrom: r.validFrom, validTo: r.validTo,
        }, 'INTERNAL', { sizeUnits: 6, sourceType: 'atlas', confidence: r.confidence, provenance: r.provenance }));
      }

      for (const c of await k.atlasStore.causalTouching(principalId, ent.id, 'both')) {
        out.push(this.mkItem('causal_hypothesis', `${c.causeRef} ~${c.relationKind}~> ${c.effectRef}`, {
          id: c.id, causeRef: c.causeRef, effectRef: c.effectRef, relationKind: c.relationKind, method: c.method,
        }, 'INTERNAL', { sizeUnits: 6, sourceType: 'atlas', confidence: c.confidence }));
      }
    }

    for (const o of await k.atlasStore.recentObservations(principalId, nowIso, 8).catch(() => [])) {
      out.push(this.mkItem('world_observation', `observed: ${o.summary} (${o.source})`, {
        id: o.id, kind: o.kind, summary: o.summary, source: o.source, observedAt: o.observedAt,
        promotedToFactId: o.promotedToFactId,
      }, 'INTERNAL', { sizeUnits: 5, sourceType: 'atlas', confidence: o.confidence, ageMs: nowMs - Date.parse(o.observedAt) }));
    }

    for (const cf of await k.atlasStore.openConflicts(principalId).catch(() => [])) {
      out.push(this.mkItem('world_conflict', `conflict on ${cf.attribute}: facts ${cf.factIdA} vs ${cf.factIdB}`, {
        id: cf.id, subjectEntityId: cf.subjectEntityId, attribute: cf.attribute, factIdA: cf.factIdA,
        factIdB: cf.factIdB, status: cf.status,
      }, 'INTERNAL', { sizeUnits: 6, sourceType: 'atlas' }));
    }

    return entityIds;
  }

  private async addMemoryItems(
    req: ContextRequest, out: RankInput[], entityIds: string[], objectiveIds: string[], nowMs: number,
  ): Promise<void> {
    const k = this.deps.knowledge!;
    const { items } = await k.recall.recall({
      text: req.intent, principalId: k.principalId(), entityIds, objectiveIds, k: 8, floor: 0.25,
    }).catch(() => ({ items: [] as Awaited<ReturnType<MemoryRecall['recall']>>['items'] }));

    for (const it of items) {
      if (it.class === 'episodic') {
        out.push(this.mkItem('episodic_memory', `episode: ${it.item.title}`, {
          id: it.item.id, title: it.item.title, summary: it.item.summary, occurredFrom: it.item.occurredFrom,
          occurredTo: it.item.occurredTo, participants: it.item.participants,
        }, it.item.privacyClass, {
          sizeUnits: 12, sourceType: 'mnemosyne', confidence: it.item.confidence, sourceRelevance: it.relevance,
          ageMs: nowMs - Date.parse(it.item.occurredTo), provenance: it.item.provenance,
        }));
      } else if (it.class === 'semantic') {
        out.push(this.mkItem('semantic_memory', `learned: ${it.item.statement}`, {
          id: it.item.id, statement: it.item.statement, sourceEpisodeIds: it.item.sourceEpisodeIds,
        }, it.item.privacyClass, {
          sizeUnits: 8, sourceType: 'mnemosyne', confidence: it.item.confidence, sourceRelevance: it.relevance,
          provenance: it.item.provenance,
        }));
      } else if (it.class === 'procedural') {
        out.push(this.mkItem('procedural_memory', `procedure: ${it.item.name} (v${it.item.version}, ${it.item.steps.length} steps)`, {
          id: it.item.id, name: it.item.name, steps: it.item.steps, version: it.item.version,
        }, 'INTERNAL', { sizeUnits: 10, sourceType: 'mnemosyne', sourceRelevance: it.relevance }));
      } else {
        out.push(this.mkItem('memory_preference', `preference: ${it.item.key} = ${summarise(it.item.value)}`, {
          id: it.item.id, key: it.item.key, value: it.item.value,
        }, it.item.privacyClass, {
          sizeUnits: 4, sourceType: 'mnemosyne', confidence: it.item.confidence, sourceRelevance: it.relevance,
        }));
      }
    }
  }

  private mkItem(
    kind: ContextItemKind,
    summary: string,
    content: unknown,
    privacyClass: PrivacyClass,
    opts: {
      ageMs?: number; sizeUnits: number; sourceType?: ContextSourceType; confidence?: number;
      sourceRelevance?: number; provenance?: ContextItem['provenance'];
    },
  ): RankInput {
    return {
      id: this.deps.ids.ulid(),
      kind,
      summary,
      content,
      privacyClass,
      sizeUnits: opts.sizeUnits,
      contentHash: hash({ kind, content }),
      provenance: opts.provenance ?? {
        method: 'derivation',
        producedBy: 'context-compiler',
        producedOn: 'local-server',
        producedAt: this.deps.clock.nowIso(),
        correlationId: 'context',
        derivedFromUntrusted: false,
      },
      ...(opts.sourceType ? { sourceType: opts.sourceType } : {}),
      ...(opts.confidence !== undefined ? { confidence: opts.confidence } : {}),
      ...(opts.sourceRelevance !== undefined ? { sourceRelevance: opts.sourceRelevance } : {}),
      ...(opts.ageMs !== undefined ? { ageMs: opts.ageMs } : {}),
    };
  }
}

function isEmptyValue(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === 'object') {
    const vals = Object.values(v as Record<string, unknown>);
    return vals.every((x) => x == null || x === '' || (Array.isArray(x) && x.length === 0));
  }
  return false;
}

function summarise(v: unknown): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 120 ? `${s.slice(0, 117)}...` : s;
}

function estimateUnits(v: unknown): number {
  return Math.max(2, Math.ceil(JSON.stringify(v).length / 4));
}
