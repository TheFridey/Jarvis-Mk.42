/**
 * Knowledge Ingestion — the SINGLE write path into ATLAS (`atlas.*`) and
 * MNEMOSYNE (`mnemosyne.*`) (ADR-0020, ATLAS_MODEL.md §4, MNEMOSYNE_MODEL.md §3).
 *
 * Kernel-internal protected service, Executor-class status: named and protected
 * by the Kernel Constitution, NOT a 17th frozen component. Perception, cognition,
 * agents, interfaces and the DREAMING routine never write either schema — they
 * hand items here and this class:
 *   - completes provenance (L11) and untrusted tagging (ADR-0018)
 *   - assigns `privacyClass`
 *   - resolves the subject entity ONCE (EntityResolver)
 *   - runs belief revision: supersede vs conflict-not-overwrite (L16)
 *   - enforces the causal `established_cause` ceiling (ADR-0021)
 *   - emits `jarvis.world.*` / `jarvis.memory.*` AFTER the write
 *
 * It also implements `ConsolidationSink`: DREAMING proposals are applied here,
 * never written by the routine itself (ADR-0022).
 */
import {
  EventNames,
  type CandidateScore,
  type Evidence,
  type IngestionItem,
  type IngestionResult,
  type KnowledgeIngestion as KnowledgeIngestionPort,
  type PrivacyClass,
  type Provenance,
  type RelationKind,
  type RoutingTarget,
  type Ulid,
} from '@jarvis/contracts';
import type { EmbeddingClient } from '@jarvis/contracts';
import type { Clock } from '../../runtime/clock.ts';
import type { IdGen } from '../../runtime/ids.ts';
import type { EventManager } from '../event-fabric/event-manager.ts';
import type { StoredEvent } from '../event-fabric/event-store.ts';
import { AtlasStore } from '../atlas/stores.ts';
import { EntityResolver } from '../atlas/entity-resolver.ts';
import { reviseBelief, type IncomingFact } from '../atlas/belief-revision.ts';
import { MnemosyneStore } from '../mnemosyne/stores.ts';
import type { ConsolidationSink } from '../mnemosyne/consolidation.ts';

type EpistemicStatus = IncomingFact['epistemicStatus'];

/** Origins that may reach `established_cause`; everything else caps at
 *  `hypothesised_cause` (ADR-0021). */
const CAUSAL_CEILING: Record<string, RelationKind> = {
  principal_assertion: 'established_cause',
  deterministic_rule: 'established_cause',
};

function capRelationKind(origin: string, requested: RelationKind): RelationKind {
  const ceiling = CAUSAL_CEILING[origin] ?? 'hypothesised_cause';
  const ladder: RelationKind[] = ['chronological', 'correlated', 'hypothesised_cause', 'established_cause'];
  return ladder.indexOf(requested) > ladder.indexOf(ceiling) ? ceiling : requested;
}

export interface KnowledgeIngestionDeps {
  atlas: AtlasStore;
  mnemosyne: MnemosyneStore;
  resolver: EntityResolver;
  embeddings: EmbeddingClient;
  events: EventManager;
  clock: Clock;
  ids: IdGen;
  /** Active principal (single-principal MK.42, mirrors the other Kernel
   *  services). Used to scope `ConsolidationSink` writes, which carry no
   *  principalId of their own. */
  principalId: () => string;
}

export class KnowledgeIngestion implements KnowledgeIngestionPort, ConsolidationSink {
  constructor(private readonly d: KnowledgeIngestionDeps) {}

  // ================================================================
  //  Primary path — IngestionItem
  // ================================================================
  async ingest(item: IngestionItem): Promise<IngestionResult> {
    const provenance = this.completeProvenance(item.provenance, item.correlationId);
    const privacyClass = this.classifyPrivacy(item, provenance);
    const emitted: Ulid[] = [];

    switch (item.kind) {
      case 'perception_observation':
        return this.ingestObservation(item, privacyClass, emitted);
      case 'extracted_fact':
        return this.ingestFact(item, provenance, privacyClass, 'inferred_or_declared', emitted);
      case 'principal_assertion':
        return this.ingestFact(item, provenance, privacyClass, 'principal', emitted);
      case 'episode':
        return this.ingestEpisodeCandidate(item, privacyClass, emitted);
      case 'consolidation_output':
        return this.ingestConsolidationOutput(item, provenance, privacyClass, emitted);
      default:
        return { routed: { targets: [], rationale: `unknown kind ${String(item.kind)}` }, emittedEventIds: [] };
    }
  }

  private async ingestObservation(
    item: IngestionItem, privacyClass: PrivacyClass, emitted: Ulid[],
  ): Promise<IngestionResult> {
    const o = item.observation;
    if (!o) return { routed: { targets: [], rationale: 'observation kind without observation payload' }, emittedEventIds: [] };
    const id = this.d.ids.ulid();
    await this.d.atlas.insertObservation({
      id, eventId: o.eventId, kind: o.kind, summary: o.summary, source: o.source, node: o.node,
      observedAt: o.observedAt, confidence: o.confidence, ...(o.rawRef ? { rawRef: o.rawRef } : {}),
      expiresAt: o.expiresAt, principalId: item.principalId,
    });
    emitted.push(await this.emit(EventNames.WorldObservationRecorded, 'observation', id, item.principalId, item.correlationId, privacyClass, {
      observationId: id, kind: o.kind, source: o.source, confidence: o.confidence,
    }));
    return { routed: { targets: ['atlas'], rationale: 'observation -> atlas.observations (promotion is deferred, not automatic)' }, atlasObservationId: id, emittedEventIds: emitted };
  }

  private async ingestFact(
    item: IngestionItem, provenance: Provenance, privacyClass: PrivacyClass,
    mode: 'principal' | 'inferred_or_declared', emitted: Ulid[],
  ): Promise<IngestionResult> {
    const f = item.fact;
    if (!f) return { routed: { targets: [], rationale: 'fact kind without fact payload' }, emittedEventIds: [] };

    // L11: a belief without a real origin is not storable. Reject before any write.
    const badProvenance = this.provenanceRejection(provenance);
    if (badProvenance) {
      return { routed: { targets: [], rationale: `fact rejected: ${badProvenance}` }, emittedEventIds: [] };
    }
    if (!Number.isFinite(f.confidence) || f.confidence < 0 || f.confidence > 1) {
      return { routed: { targets: [], rationale: `fact rejected: confidence ${String(f.confidence)} outside 0..1 (L12)` }, emittedEventIds: [] };
    }

    const resolved = await this.d.resolver.resolve({
      principalId: item.principalId, ref: f.subjectRef, privacyClass, source: provenance.producedBy,
    });
    if (resolved.created) {
      emitted.push(await this.emit(EventNames.WorldEntityUpserted, 'entity', resolved.entityId, item.principalId, item.correlationId, privacyClass, {
        entityId: resolved.entityId, method: resolved.method,
      }));
    }

    const now = this.d.clock.nowIso();
    const epistemicStatus: EpistemicStatus = this.capEpistemicStatus(f.epistemicStatus, mode, provenance);
    const incoming: IncomingFact = {
      attribute: f.attribute, value: f.value, epistemicStatus, confidence: f.confidence,
      validFrom: f.validFrom ?? now, principalAsserted: mode === 'principal',
    };
    const active = await this.d.atlas.activeFacts(item.principalId, resolved.entityId, f.attribute);
    const outcome = reviseBelief(active, incoming);

    const factId = this.d.ids.ulid();
    const supersededIds = outcome.action === 'supersede' ? outcome.supersedeFactIds
      : outcome.action === 'conflict' && outcome.resolvedByPrincipal ? outcome.conflictWithFactIds : [];

    await this.d.atlas.insertFact({
      id: factId, subjectEntityId: resolved.entityId, attribute: f.attribute,
      ...(f.predicate ? { predicate: f.predicate } : {}), value: f.value, epistemicStatus,
      provenance, confidence: f.confidence, validFrom: incoming.validFrom,
      ...(f.validTo ? { validTo: f.validTo } : {}),
      ...(supersededIds[0] ? { supersedesFactId: supersededIds[0] } : {}),
      contradictionOf: outcome.action === 'conflict' ? outcome.conflictWithFactIds : [],
      privacyClass, principalId: item.principalId,
    });

    // evidence
    const evidenceKind = mode === 'principal' ? 'principal_assertion' : 'inference_run';
    for (const ref of f.evidenceRefs.length > 0 ? f.evidenceRefs : [item.correlationId]) {
      await this.d.atlas.insertEvidence({
        id: this.d.ids.ulid(), subjectKind: 'fact', subjectId: factId, kind: evidenceKind, ref,
        principalId: item.principalId,
      });
    }
    if (item.episode) {
      await this.d.atlas.insertEvidence({
        id: this.d.ids.ulid(), subjectKind: 'fact', subjectId: factId, kind: 'episode',
        ref: item.episode.sourceEventIds[0] ?? item.correlationId, note: 'derived-from-experience',
        principalId: item.principalId,
      });
    }

    // apply the revision outcome
    let conflictId: Ulid | undefined;
    if (outcome.action === 'supersede') {
      for (const sid of outcome.supersedeFactIds) {
        await this.d.atlas.archiveFact(sid, 'superseded', now);
        emitted.push(await this.emit(EventNames.WorldFactSuperseded, 'fact', sid, item.principalId, item.correlationId, privacyClass, {
          factId: sid, bySupersedingFactId: factId, reason: outcome.reason,
        }));
      }
    } else if (outcome.action === 'conflict') {
      for (const rivalId of outcome.conflictWithFactIds) {
        conflictId = this.d.ids.ulid();
        await this.d.atlas.openConflict({
          id: conflictId, subjectEntityId: resolved.entityId, attribute: f.attribute,
          factIdA: rivalId, factIdB: factId, principalId: item.principalId,
        });
        const rival = active.find((x) => x.id === rivalId);
        if (rival) await this.d.atlas.setFactContradictions(rivalId, [...rival.contradictionOf, factId]);
        emitted.push(await this.emit(EventNames.WorldConflictRecorded, 'conflict', conflictId, item.principalId, item.correlationId, privacyClass, {
          conflictId, subjectEntityId: resolved.entityId, attribute: f.attribute, factIdA: rivalId, factIdB: factId,
        }));
        if (outcome.resolvedByPrincipal) {
          await this.d.atlas.archiveFact(rivalId, 'superseded', now);
          await this.d.atlas.resolveConflict(conflictId, 'resolved_by_principal');
          emitted.push(await this.emit(EventNames.WorldConflictResolved, 'conflict', conflictId, item.principalId, item.correlationId, privacyClass, {
            conflictId, resolution: 'resolved_by_principal',
          }));
        }
      }
    }

    emitted.push(await this.emit(EventNames.WorldFactAsserted, 'fact', factId, item.principalId, item.correlationId, privacyClass, {
      factId, subjectEntityId: resolved.entityId, attribute: f.attribute, epistemicStatus,
      confidence: f.confidence, action: outcome.action,
    }));

    const targets: RoutingTarget[] = item.episode ? ['atlas', 'mnemosyne'] : ['atlas'];
    if (item.episode) await this.ingestEpisodeCandidate(item, privacyClass, emitted);

    return {
      routed: { targets, rationale: `${item.kind} -> atlas fact (${outcome.action})${item.episode ? ' + mnemosyne episode candidate' : ''}` },
      atlasFactId: factId, ...(conflictId ? { conflictId } : {}), emittedEventIds: emitted,
    };
  }

  private async ingestEpisodeCandidate(
    item: IngestionItem, privacyClass: PrivacyClass, emitted: Ulid[],
  ): Promise<IngestionResult> {
    const ep = item.episode;
    if (!ep) return { routed: { targets: [], rationale: 'episode kind without episode payload' }, emittedEventIds: [] };
    const id = this.d.ids.ulid();
    await this.d.mnemosyne.insertCandidate({
      id, sourceEventId: ep.sourceEventIds[0] ?? item.correlationId, sourceKind: ep.kind,
      content: {
        title: ep.title, summary: ep.summary, occurredFrom: ep.occurredFrom, occurredTo: ep.occurredTo,
        participants: ep.participantsRefs, sourceEventIds: ep.sourceEventIds, privacyClass,
        ...(ep.salienceHint !== undefined ? { salienceHint: ep.salienceHint } : {}),
      },
      principalId: item.principalId,
    });
    return {
      routed: { targets: ['mnemosyne'], rationale: 'episode -> mnemosyne.candidates (must pass the scorer gate before it becomes an episode)' },
      mnemosyneCandidateId: id, emittedEventIds: emitted,
    };
  }

  private async ingestConsolidationOutput(
    item: IngestionItem, provenance: Provenance, privacyClass: PrivacyClass, emitted: Ulid[],
  ): Promise<IngestionResult> {
    // A DREAMING proposal carrying a fact and/or an episode. Evidence chain is
    // mandatory for a consolidation-derived fact (ADR-0022).
    if (item.fact && item.fact.evidenceRefs.length === 0) {
      return { routed: { targets: [], rationale: 'consolidation fact rejected: no evidence chain (ADR-0022)' }, emittedEventIds: [] };
    }
    if (item.fact) {
      const capped: IngestionItem = {
        ...item,
        fact: { ...item.fact, epistemicStatus: item.fact.epistemicStatus === 'derived' ? 'derived' : 'inferred' },
      };
      return this.ingestFact(capped, provenance, privacyClass, 'inferred_or_declared', emitted);
    }
    if (item.episode) return this.ingestEpisodeCandidate(item, privacyClass, emitted);
    return { routed: { targets: [], rationale: 'consolidation output carried nothing actionable' }, emittedEventIds: [] };
  }

  /** Hypothesise a causal link. Never presents correlation as cause: the origin
   *  determines the ceiling (ADR-0021). */
  async hypothesise(input: {
    principalId: string; correlationId: string; causeRef: string; effectRef: string;
    relationKind: RelationKind; confidence: number; evidence: string[]; method: string;
    origin: 'principal_assertion' | 'deterministic_rule' | 'cognition' | 'consolidation';
  }): Promise<Ulid> {
    const id = this.d.ids.ulid();
    const relationKind = capRelationKind(input.origin, input.relationKind);
    await this.d.atlas.insertCausal({
      id, causeRef: input.causeRef, effectRef: input.effectRef, relationKind,
      confidence: input.confidence, evidence: input.evidence.length > 0 ? input.evidence : [input.correlationId],
      method: input.method, validFrom: this.d.clock.nowIso(), principalId: input.principalId,
    });
    await this.emit(EventNames.WorldCausalHypothesised, 'causal', id, input.principalId, input.correlationId, 'INTERNAL', {
      causalHypothesisId: id, relationKind, requested: input.relationKind, origin: input.origin,
    });
    return id;
  }

  /** Assert a temporal relationship, closing any open one of the same shape. */
  async relate(input: {
    principalId: string; correlationId: string; fromRef: string; toRef: string;
    type: string; confidence: number; provenance: Provenance; validFrom?: string; observedAt?: string;
  }): Promise<Ulid> {
    const now = this.d.clock.nowIso();
    const from = await this.d.resolver.resolve({ principalId: input.principalId, ref: input.fromRef, source: input.provenance.producedBy });
    const to = await this.d.resolver.resolve({ principalId: input.principalId, ref: input.toRef, source: input.provenance.producedBy });
    const existing = await this.d.atlas.activeRelationshipLike(input.principalId, from.entityId, to.entityId, input.type);
    if (existing) await this.d.atlas.closeRelationship(existing.id, input.validFrom ?? now);
    const id = this.d.ids.ulid();
    await this.d.atlas.insertRelationship({
      id, fromEntityId: from.entityId, toEntityId: to.entityId, type: input.type,
      provenance: this.completeProvenance(input.provenance, input.correlationId), confidence: input.confidence,
      validFrom: input.validFrom ?? now, observedAt: input.observedAt ?? now, principalId: input.principalId,
    });
    await this.emit(EventNames.WorldRelationshipAsserted, 'relationship', id, input.principalId, input.correlationId, 'INTERNAL', {
      relationshipId: id, from: from.entityId, to: to.entityId, type: input.type,
    });
    return id;
  }

  // ================================================================
  //  ConsolidationSink — DREAMING proposals applied here (ADR-0022)
  // ================================================================
  async acceptEpisode(candidateId: Ulid, score: CandidateScore, episode: {
    kind: string; title: string; summary: string; occurredFrom: string; occurredTo: string;
    participants: string[]; sourceEventIds: string[]; salience: number; confidence: number;
    privacyClass: PrivacyClass; provenance: Provenance;
  }): Promise<Ulid> {
    const cand = await this.d.mnemosyne.getCandidate(candidateId);
    const principalId = cand?.principalId ?? 'system';
    const id = this.d.ids.ulid();
    const { vector, modelId } = await this.d.embeddings.embed(`${episode.title} ${episode.summary}`);
    await this.d.mnemosyne.insertEpisode({
      id, kind: episode.kind, title: episode.title, summary: episode.summary,
      occurredFrom: episode.occurredFrom, occurredTo: episode.occurredTo, participants: episode.participants,
      sourceEventIds: episode.sourceEventIds, salience: clamp01(episode.salience), confidence: clamp01(episode.confidence),
      provenance: episode.provenance, privacyClass: episode.privacyClass, embedding: vector,
      embeddingModelId: modelId, principalId,
    });
    await this.d.mnemosyne.disposeCandidate(candidateId, 'accepted', score, this.d.clock.nowIso(), id);
    await this.emit(EventNames.MemoryEpisodeRecorded, 'episode', id, principalId, cand?.sourceEventId ?? id, episode.privacyClass, {
      episodeId: id, kind: episode.kind, salience: episode.salience, fromCandidateId: candidateId,
    });
    await this.emit(EventNames.MemoryCandidateDisposed, 'candidate', candidateId, principalId, cand?.sourceEventId ?? candidateId, episode.privacyClass, {
      candidateId, disposition: 'accepted', composite: score.composite, episodeId: id,
    });
    return id;
  }

  async mergeCandidateInto(candidateId: Ulid, score: CandidateScore, episodeId: Ulid): Promise<void> {
    const cand = await this.d.mnemosyne.getCandidate(candidateId);
    await this.d.mnemosyne.disposeCandidate(candidateId, 'merged', score, this.d.clock.nowIso(), episodeId);
    await this.emit(EventNames.MemoryCandidateDisposed, 'candidate', candidateId, cand?.principalId ?? 'system', candidateId, 'INTERNAL', {
      candidateId, disposition: 'merged', episodeId,
    });
  }

  async dropCandidate(candidateId: Ulid, score: CandidateScore, disposition: 'rejected' | 'deferred'): Promise<void> {
    const cand = await this.d.mnemosyne.getCandidate(candidateId);
    await this.d.mnemosyne.disposeCandidate(candidateId, disposition, score, this.d.clock.nowIso());
    await this.emit(EventNames.MemoryCandidateDisposed, 'candidate', candidateId, cand?.principalId ?? 'system', candidateId, 'INTERNAL', {
      candidateId, disposition, composite: score.composite,
    });
  }

  async learnSemantic(input: {
    statement: string; evidence: string[]; provenance: Provenance; confidence: number;
    privacyClass: PrivacyClass; sourceEpisodeIds: string[];
  }): Promise<Ulid | undefined> {
    if (input.evidence.length === 0) return undefined; // no evidence chain -> rejected (ADR-0022)
    const principalId = this.d.principalId();
    const id = this.d.ids.ulid();
    const { vector, modelId } = await this.d.embeddings.embed(input.statement);
    await this.d.mnemosyne.insertSemantic({
      id, statement: input.statement, confidence: clamp01(input.confidence), provenance: input.provenance,
      sourceEpisodeIds: input.sourceEpisodeIds, privacyClass: input.privacyClass, relevance: 0.6,
      embedding: vector, embeddingModelId: modelId, principalId,
    });
    await this.emit(EventNames.MemorySemanticLearned, 'semantic', id, principalId, input.provenance.correlationId, input.privacyClass, {
      semanticId: id, evidenceCount: input.evidence.length,
    });
    return id;
  }

  async reinforceSemantic(id: Ulid, newConfidence: number): Promise<void> {
    await this.d.mnemosyne.reinforceSemantic(id, clamp01(newConfidence), this.d.clock.nowIso());
  }

  async decaySemantic(id: Ulid, newConfidence: number): Promise<void> {
    await this.d.mnemosyne.decaySemantic(id, clamp01(newConfidence));
  }

  async updateProcedure(
    name: string, steps: Array<{ step: number; action: string }>, sourceEpisodeIds: string[],
  ): Promise<void> {
    const { id, version } = await this.d.mnemosyne.upsertProcedure({
      id: this.d.ids.ulid(), name, steps, sourceEpisodeIds, principalId: this.d.principalId(),
    });
    await this.emit(EventNames.MemoryProcedureUpdated, 'procedure', id, this.d.principalId(), id, 'INTERNAL', {
      procedureId: id, name, version, steps: steps.length,
    });
  }

  async mergeEpisodes(loserId: Ulid, winnerId: Ulid): Promise<void> {
    await this.d.mnemosyne.supersedeEpisode(loserId, winnerId, this.d.clock.nowIso());
  }

  async recordInsight(runId: Ulid, input: {
    statement: string; significance: number; evidence: string[]; provenance: Provenance;
  }): Promise<void> {
    if (input.evidence.length === 0) return; // ADR-0022 + insights_evidence_nonempty_ck
    await this.d.mnemosyne.insertInsight({
      id: this.d.ids.ulid(), statement: input.statement, significance: clamp01(input.significance),
      provenance: input.provenance, evidence: input.evidence, consolidationRunId: runId,
      principalId: this.d.principalId(),
    });
  }

  /** Surfacing check (MNEMOSYNE_MODEL.md §6): emit `insight.available` only for
   *  evidence-backed, significant, context-relevant, not-already-surfaced insights.
   *  Zero surfaced is the expected normal case. */
  async surfaceInsights(principalId: string, contextRefs: string[], floor: number): Promise<number> {
    const insights = await this.d.mnemosyne.unsurfacedInsights(principalId);
    let surfaced = 0;
    for (const i of insights) {
      if (i.significance < floor) continue;
      if (i.evidence.length === 0) continue;
      const relevant = contextRefs.length === 0
        ? i.significance >= floor + 0.2
        : i.evidence.some((e) => contextRefs.includes(e)) || contextRefs.some((c) => i.statement.toLowerCase().includes(c.toLowerCase()));
      if (!relevant) continue;
      await this.d.mnemosyne.markInsightSurfaced(i.id, this.d.clock.nowIso());
      await this.emit(EventNames.MemoryInsightAvailable, 'insight', i.id, principalId, i.consolidationRunId, 'INTERNAL', {
        insightId: i.id, significance: i.significance, evidenceCount: i.evidence.length,
      });
      surfaced++;
    }
    return surfaced;
  }

  // ================================================================
  //  Forgetting — the one operation that genuinely deletes
  //  (MNEMOSYNE_MODEL.md §8, ATLAS_MODEL.md §9). Right-to-erasure /
  //  privacy deletion. Everything else archives.
  //
  //  The tombstone records only THAT a forget happened (id + reason + actor) —
  //  never the forgotten content. Ledger events are never touched.
  //
  //  RC-audit fix: `MnemosyneStore.forgetEpisode` / `AtlasStore.forgetEntity`
  //  existed with no caller and no tombstone, so the documented deletion path
  //  was unreachable.
  // ================================================================
  async forgetMemory(episodeId: Ulid, input: { principalId: string; reason: string; actor: string; correlationId?: string }): Promise<boolean> {
    const existing = await this.d.mnemosyne.getEpisode(episodeId);
    if (!existing) return false;
    await this.d.mnemosyne.forgetEpisode(episodeId);
    const correlationId = input.correlationId ?? episodeId;
    await this.emit(EventNames.MemoryForgotten, 'episode', episodeId, input.principalId, correlationId, 'INTERNAL', {
      episodeId, reason: input.reason, actor: input.actor,
    });
    return true;
  }

  async forgetWorldEntity(entityId: Ulid, input: { principalId: string; reason: string; actor: string; correlationId?: string }): Promise<boolean> {
    const existing = await this.d.atlas.getEntity(entityId);
    if (!existing) return false;
    await this.d.atlas.forgetEntity(entityId);
    const correlationId = input.correlationId ?? entityId;
    await this.emit(EventNames.WorldForgotten, 'entity', entityId, input.principalId, correlationId, 'INTERNAL', {
      entityId, reason: input.reason, actor: input.actor,
    });
    return true;
  }

  // ================================================================
  //  Event-derived candidates (CandidateSource feeds these)
  // ================================================================
  async recordEventCandidate(event: StoredEvent): Promise<Ulid | undefined> {
    const summary = summariseEvent(event);
    if (!summary) return undefined;
    const id = this.d.ids.ulid();
    await this.d.mnemosyne.insertCandidate({
      id, sourceEventId: event.id, sourceKind: candidateKindFor(event.type),
      content: {
        summary, text: summary, type: event.type, correlationId: event.correlationId,
        privacyClass: event.privacyClass, confidence: event.confidence ?? 0.6,
        participants: [], sourceEventIds: [event.id],
      },
      principalId: event.principalId,
    });
    return id;
  }

  // ================================================================
  //  helpers
  // ================================================================
  /**
   * Complete the caller's provenance seed. It fills only the fields the mediator
   * legitimately owns (`producedOn`, `producedAt`, `correlationId`); it MUST NOT
   * invent `method` or `producedBy`, because a manufactured origin is worse than
   * no fact at all (L11, ATLAS_MODEL.md §3: "the ingestion mediator rejects a
   * fact without it"). Callers that omit them are rejected by
   * `assertProvenanceUsable`.
   *
   * RC-audit fix: this used to default `method` to 'system' and `producedBy` to
   * 'knowledge-ingestion', silently fabricating provenance for any caller.
   */
  private completeProvenance(seed: Provenance, correlationId: string): Provenance {
    return {
      method: seed.method,
      producedBy: seed.producedBy,
      producedOn: seed.producedOn || 'local-server',
      producedAt: seed.producedAt || this.d.clock.nowIso(),
      correlationId: seed.correlationId || correlationId,
      derivedFromUntrusted: Boolean(seed.derivedFromUntrusted),
      ...(seed.model ? { model: seed.model } : {}),
      ...(seed.sourceRefs ? { sourceRefs: seed.sourceRefs } : {}),
    };
  }

  /** Fact-bearing ingestion requires a real origin (L11). Returns a rejection
   *  rationale, or undefined when the provenance is usable. */
  private provenanceRejection(p: Provenance): string | undefined {
    const methods: Provenance['method'][] = ['sensor', 'model', 'retrieval', 'inference', 'assertion', 'derivation', 'system'];
    if (!p.method || !methods.includes(p.method)) return `provenance.method missing or invalid (${String(p.method)})`;
    if (!p.producedBy || p.producedBy.trim() === '') return 'provenance.producedBy missing';
    if (!p.producedAt || Number.isNaN(Date.parse(p.producedAt))) return 'provenance.producedAt missing or unparseable';
    return undefined;
  }

  /**
   * Epistemic-status ceiling (L14, ATLAS_MODEL.md §3). `observed` means
   * "perception sensed this directly" and may therefore only be claimed by a
   * sensor-origin producer — the observation-promotion evaluator. `asserted`
   * belongs to a principal Command. Anything else that claims either is
   * downgraded to `inferred`, so an inference can never masquerade as an
   * observation.
   *
   * RC-audit fix: previously only the agent facade capped this, so any direct
   * `extracted_fact` caller could store `observed`.
   */
  private capEpistemicStatus(requested: EpistemicStatus, mode: 'principal' | 'inferred_or_declared', provenance: Provenance): EpistemicStatus {
    if (mode === 'principal') return 'asserted';
    if (requested === 'observed') return provenance.method === 'sensor' ? 'observed' : 'inferred';
    if (requested === 'asserted') return 'inferred';
    return requested;
  }

  /**
   * Privacy classification. An explicit caller hint wins (the principal knows
   * what is sensitive). Otherwise the class is derived, and untrusted-derived
   * material may never be published as PUBLIC (ADR-0018).
   *
   * RC-audit note: this used to be a dead ladder where every branch returned
   * INTERNAL. It is still conservative-by-default rather than content-aware —
   * automatic sensitivity detection is tracked debt, not a shipped capability.
   */
  private classifyPrivacy(item: IngestionItem, provenance: Provenance): PrivacyClass {
    const hinted = item.privacyHint;
    if (hinted) return provenance.derivedFromUntrusted && hinted === 'PUBLIC' ? 'INTERNAL' : hinted;
    return 'INTERNAL';
  }

  private async emit(
    type: string, subjectKind: string, id: string, principalId: string, correlationId: string,
    privacyClass: PrivacyClass, payload: Record<string, unknown>,
  ): Promise<Ulid> {
    const ev = await this.d.events.emit({
      type: type as never,
      retentionClass: type.includes('.memory.') ? 'MEMORY_CANDIDATE' : 'AUDIT',
      privacyClass,
      subject: { kind: subjectKind, id },
      actor: { kind: 'system', id: 'knowledge-ingestion' },
      correlationId, causationId: correlationId, principalId, payload,
    }).catch(() => undefined);
    return ev?.id ?? '';
  }
}

// --- pure helpers used by recordEventCandidate ---------------------
function candidateKindFor(type: string): string {
  if (type.includes('objective')) return 'objective_outcome';
  if (type.includes('cognition')) return 'session_outcome';
  if (type.includes('invocation.verified')) return 'action_outcome';
  return 'event';
}

function summariseEvent(event: StoredEvent): string | undefined {
  const p = (event.payload ?? {}) as Record<string, unknown>;
  switch (event.type) {
    case EventNames.CognitionCompleted:
      return `Cognition ${String(p.modelId ?? '')} completed with ${String(p.proposalCount ?? 0)} proposal(s)`;
    case EventNames.CognitionResultDelivered:
      return p.hasAnswer ? 'Delivered an answer to the operator' : undefined;
    case EventNames.ObjectiveTransitioned:
      return `Objective ${String(p.from ?? '')} -> ${String(p.to ?? '')}: ${String(p.reason ?? '')}`;
    case EventNames.InvocationVerified:
      return `Capability invocation verified (${String(p.verifyReportRef ?? '')})`;
    default:
      return event.retentionClass === 'MEMORY_CANDIDATE'
        ? `${event.type} @ ${event.time}`
        : undefined;
  }
}

function clamp01(n: number): number { return Math.max(0, Math.min(1, n)); }
export type { Evidence };
