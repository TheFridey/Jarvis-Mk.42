/**
 * Context Compiler (KERNEL_CONSTITUTION.md #5, COGNITION_MODEL.md sec 4).
 *
 * MK.43: deterministic scaffold. It gathers candidate items from the
 * authoritative state slices + recent events + registered capability names,
 * assigns each a provenance + privacyClass + deterministic relevance, then
 * ranks / privacy-filters / dedupes / budget-truncates into a ContextPackage.
 * It works with ZERO AI retrieval. Every package is versioned.
 *
 * It NEVER calls a model and NEVER causes an effect.
 */
import {
  EventNames,
  type ContextItem,
  type ContextItemKind,
  type ContextPackage,
  type ContextRequest,
  type PrivacyClass,
  type StateSliceKey,
} from '@jarvis/contracts';
import { createHash } from 'node:crypto';
import type { Clock } from '../../runtime/clock.ts';
import type { IdGen } from '../../runtime/ids.ts';
import type { EventManager } from '../event-fabric/event-manager.ts';
import type { EventStore } from '../event-fabric/event-store.ts';
import type { StateManager } from '../state/state-manager.ts';
import { buildPackage, scoreItem, type RankInput } from './ranking.ts';

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

export interface ContextCompilerDeps {
  state: StateManager;
  eventStore: EventStore;
  events: EventManager;
  clock: Clock;
  ids: IdGen;
  /** Names of registered capabilities, injected so the compiler stays decoupled. */
  availableCapabilities: () => string[];
}

function hash(v: unknown): string {
  return createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);
}

export class ContextCompiler {
  private version = 0;

  constructor(private readonly deps: ContextCompilerDeps) {}

  async compile(req: ContextRequest): Promise<ContextPackage> {
    const now = this.deps.clock.epochMs();
    const candidates: RankInput[] = [];
    const unknowns: string[] = [];

    // 1. authoritative state slices
    const view = await this.deps.state.view();
    for (const [key, kind] of Object.entries(SLICE_TO_KIND) as [StateSliceKey, ContextItemKind][]) {
      const slice = view.slices[key];
      const empty = isEmptyValue(slice.value);
      if (empty) {
        unknowns.push(`no ${key}`);
        continue;
      }
      candidates.push(
        this.mkItem(kind, `${key}: ${summarise(slice.value)}`, slice.value, 'INTERNAL', {
          ageMs: now - Date.parse(slice.updatedAt),
          sizeUnits: estimateUnits(slice.value),
        }),
      );
    }

    // 2. recent events (bounded)
    const recent = await this.deps.eventStore.readFrom('0', 40);
    const tail = recent.slice(-20);
    for (const e of tail) {
      candidates.push(
        this.mkItem('recent_event', `${e.type} @ ${e.time}`, { type: e.type, subject: e.subject }, e.privacyClass, {
          ageMs: now - Date.parse(e.time),
          sizeUnits: 8,
        }),
      );
    }

    // 3. available capabilities (names only)
    for (const cap of this.deps.availableCapabilities()) {
      candidates.push(
        this.mkItem('available_capability', `capability: ${cap}`, { id: cap }, 'PUBLIC', {
          sizeUnits: 3,
        }),
      );
    }

    // score
    const scored: ContextItem[] = candidates.map((c) => ({
      ...c,
      relevance: scoreItem(c, req),
    }));

    const result = buildPackage(scored, req);

    this.version++;
    const pkg: ContextPackage = {
      id: this.deps.ids.ulid(),
      version: this.version,
      request: req,
      compiledAt: this.deps.clock.nowIso(),
      items: result.kept,
      budget: {
        limitUnits: req.budgetUnits,
        usedUnits: result.usedUnits,
        truncated: result.truncated,
        omitted: result.omitted,
      },
      unknowns,
      filtered: { byPrivacy: result.byPrivacy, byDedupe: result.byDedupe },
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

  private mkItem(
    kind: ContextItemKind,
    summary: string,
    content: unknown,
    privacyClass: PrivacyClass,
    opts: { ageMs?: number; sizeUnits: number },
  ): RankInput {
    return {
      id: this.deps.ids.ulid(),
      kind,
      summary,
      content,
      privacyClass,
      sizeUnits: opts.sizeUnits,
      contentHash: hash({ kind, content }),
      provenance: {
        method: 'derivation',
        producedBy: 'context-compiler',
        producedOn: 'local-server',
        producedAt: this.deps.clock.nowIso(),
        correlationId: 'context',
        derivedFromUntrusted: false,
      },
      ...(opts.ageMs !== undefined ? { ageMs: opts.ageMs } : {}),
    };
  }
}

function isEmptyValue(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === 'object') {
    const vals = Object.values(v as Record<string, unknown>);
    return vals.every(
      (x) => x == null || x === '' || (Array.isArray(x) && x.length === 0),
    );
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
