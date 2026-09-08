/**
 * Consolidation — "DREAMING" (MNEMOSYNE_MODEL.md §5, ADR-0022).
 *
 * A Scheduler routine, NOT cognition and NOT an agent loop. It READS events,
 * episodes, candidates, objective progress, procedures and working memory; it
 * PRODUCES PROPOSALS ONLY, routed through the Knowledge Ingestion mediator via
 * `ConsolidationSink`. It writes nothing in `mnemosyne.*` / `atlas.*` itself
 * except its own audit log (`mnemosyne.consolidation_runs`).
 *
 * MK.46 runs DETERMINISTIC RULES ONLY (no model). Zero insights on a run is the
 * expected normal case — nothing is fabricated to seem intelligent. Every
 * generated insight carries an evidence chain or the mediator rejects it.
 *
 * Per-run proposal cap: overflow defers to the next run (ADR-0022 §Risks).
 */
import type { CandidateScore, Provenance, Ulid } from '@jarvis/contracts';
import { cosineSimilarity } from '@jarvis/contracts';
import type { EmbeddingClient } from '@jarvis/contracts';
import type { Clock } from '../../runtime/clock.ts';
import type { IdGen } from '../../runtime/ids.ts';
import type { MnemosyneStore } from './stores.ts';
import { decideDisposition, scoreCandidate, type ScoreContext } from './candidate-pipeline.ts';

export interface ConsolidationSink {
  acceptEpisode(candidateId: Ulid, score: CandidateScore, episode: {
    kind: string; title: string; summary: string; occurredFrom: string; occurredTo: string;
    participants: string[]; sourceEventIds: string[]; salience: number; confidence: number;
    privacyClass: 'PUBLIC' | 'INTERNAL' | 'SENSITIVE' | 'RESTRICTED'; provenance: Provenance;
  }): Promise<Ulid>;
  mergeCandidateInto(candidateId: Ulid, score: CandidateScore, episodeId: Ulid): Promise<void>;
  dropCandidate(candidateId: Ulid, score: CandidateScore, disposition: 'rejected' | 'deferred'): Promise<void>;
  learnSemantic(input: {
    statement: string; evidence: string[]; provenance: Provenance; confidence: number;
    privacyClass: 'PUBLIC' | 'INTERNAL' | 'SENSITIVE' | 'RESTRICTED'; sourceEpisodeIds: string[];
  }): Promise<Ulid | undefined>;
  reinforceSemantic(id: Ulid, newConfidence: number): Promise<void>;
  decaySemantic(id: Ulid, newConfidence: number): Promise<void>;
  updateProcedure(name: string, steps: Array<{ step: number; action: string }>, sourceEpisodeIds: string[]): Promise<void>;
  mergeEpisodes(loserId: Ulid, winnerId: Ulid): Promise<void>;
  recordInsight(runId: Ulid, input: { statement: string; significance: number; evidence: string[]; provenance: Provenance }): Promise<void>;
}

export interface ConsolidationConfig {
  /** Max proposals per run; the rest defer to the next pass. */
  maxProposalsPerRun: number;
  /** Episodes with cosine >= this AND time overlap are merge candidates. */
  episodeMergeSimilarity: number;
  /** N identical candidate statements => a semantic-memory proposal. */
  semanticRepetitionThreshold: number;
  /** Days without reinforcement before an inferred/predicted semantic row decays. */
  staleDays: number;
  /** Significance floor for an insight to be recorded. */
  insightSignificanceFloor: number;
  /** Lookback window for episodes/semantic scanned each run. */
  lookbackDays: number;
}

export const DEFAULT_CONSOLIDATION_CONFIG: ConsolidationConfig = {
  maxProposalsPerRun: 50,
  episodeMergeSimilarity: 0.92,
  semanticRepetitionThreshold: 3,
  staleDays: 30,
  insightSignificanceFloor: 0.6,
  lookbackDays: 14,
};

export interface ConsolidationResult {
  runId: Ulid;
  inputsScanned: Record<string, number>;
  proposalsEmitted: number;
  outcomes: Record<string, number>;
}

function provenanceFor(now: string, runId: string): Provenance {
  return {
    method: 'derivation',
    producedBy: 'mnemosyne.consolidate',
    producedOn: 'local-server',
    producedAt: now,
    correlationId: runId,
    derivedFromUntrusted: false,
    sourceRefs: [`consolidation:${runId}`],
  };
}

export class Consolidator {
  constructor(
    private readonly deps: {
      store: MnemosyneStore;
      sink: ConsolidationSink;
      embeddings: EmbeddingClient;
      clock: Clock;
      ids: IdGen;
      /** Active objective ids, for the objective-relevance factor. */
      activeObjectiveIds: () => Promise<string[]>;
    },
    private readonly config: ConsolidationConfig = DEFAULT_CONSOLIDATION_CONFIG,
  ) {}

  async run(principalId: string): Promise<ConsolidationResult> {
    const now = this.deps.clock.nowIso();
    const runId = this.deps.ids.ulid();
    await this.deps.store.startRun(runId, principalId, now);

    const sinceIso = new Date(this.deps.clock.epochMs() - this.config.lookbackDays * 86_400_000).toISOString();
    const candidates = await this.deps.store.pendingCandidates(principalId);
    const episodes = await this.deps.store.recentEpisodes(principalId, sinceIso);
    const semantic = await this.deps.store.allSemantic(principalId);
    const objectiveIds = new Set(await this.deps.activeObjectiveIds());

    const inputsScanned = {
      candidates: candidates.length, episodes: episodes.length, semantic: semantic.length,
    };
    const outcomes = {
      accepted: 0, merged: 0, rejected: 0, deferred: 0, semanticLearned: 0,
      semanticReinforced: 0, semanticDecayed: 0, episodeMerges: 0, proceduresUpdated: 0, insights: 0,
    };
    let budget = this.config.maxProposalsPerRun;
    const prov = provenanceFor(now, runId);

    // --- 1. score + dispose pending candidates -------------------------
    const statementCounts = new Map<string, { count: number; evidence: string[]; sample: string }>();
    for (const c of candidates) {
      if (budget <= 0) { await this.deps.sink.dropCandidate(c.id, zeroScore(), 'deferred'); outcomes.deferred++; continue; }
      const text = candidateText(c.content);
      const { vector } = await this.deps.embeddings.embed(text);
      let maxSim = 0;
      for (const e of episodes) {
        const es = await this.deps.embeddings.embed(`${e.title} ${e.summary}`);
        maxSim = Math.max(maxSim, cosineSimilarity(vector, es.vector));
      }
      const ctx: ScoreContext = {
        maxSimilarityToStored: maxSim,
        touchesActiveObjective: refsTouch(c.content, objectiveIds),
        confidenceHint: candidateConfidence(c.content),
        privacyClass: candidatePrivacy(c.content),
        sourceKind: c.sourceKind,
        looksDurable: looksDurable(text),
      };
      const score = scoreCandidate(ctx);
      const disposition = decideDisposition(score);

      if (disposition === 'accepted') {
        await this.deps.sink.acceptEpisode(c.id, score, {
          kind: c.sourceKind === 'conversation' ? 'conversation' : 'action_outcome',
          title: text.slice(0, 80),
          summary: text.slice(0, 400),
          occurredFrom: c.createdAt,
          occurredTo: c.createdAt,
          participants: candidateParticipants(c.content),
          sourceEventIds: [c.sourceEventId],
          salience: score.importance,
          confidence: score.confidence,
          privacyClass: ctx.privacyClass,
          provenance: prov,
        });
        outcomes.accepted++;
        const key = normStatement(text);
        const agg = statementCounts.get(key) ?? { count: 0, evidence: [], sample: text };
        agg.count++; agg.evidence.push(c.sourceEventId);
        statementCounts.set(key, agg);
        budget--;
      } else if (disposition === 'merged') {
        const target = episodes[0];
        if (target) { await this.deps.sink.mergeCandidateInto(c.id, score, target.id); outcomes.merged++; }
        else { await this.deps.sink.dropCandidate(c.id, score, 'rejected'); outcomes.rejected++; }
        budget--;
      } else if (disposition === 'rejected') {
        await this.deps.sink.dropCandidate(c.id, score, 'rejected'); outcomes.rejected++;
      } else {
        await this.deps.sink.dropCandidate(c.id, score, 'deferred'); outcomes.deferred++;
      }
    }

    // --- 2. extract durable semantic memory from repetition -----------
    for (const [, agg] of statementCounts) {
      if (budget <= 0) break;
      if (agg.count < this.config.semanticRepetitionThreshold) continue;
      const existing = await this.deps.store.findSemanticByStatement(principalId, agg.sample);
      if (existing) {
        await this.deps.sink.reinforceSemantic(existing.id, Math.min(0.95, existing.confidence + 0.05));
        outcomes.semanticReinforced++;
      } else {
        const id = await this.deps.sink.learnSemantic({
          statement: agg.sample,
          evidence: agg.evidence,
          provenance: prov,
          confidence: Math.min(0.8, 0.4 + 0.1 * agg.count),
          privacyClass: 'INTERNAL',
          sourceEpisodeIds: [],
        });
        if (id) outcomes.semanticLearned++;
      }
      budget--;
    }

    // --- 3. merge near-duplicate episodes ---------------------------
    for (let i = 0; i < episodes.length && budget > 0; i++) {
      for (let k = i + 1; k < episodes.length && budget > 0; k++) {
        const a = episodes[i]!; const b = episodes[k]!;
        if (a.supersededBy || b.supersededBy) continue;
        if (!timeOverlap(a, b)) continue;
        const [ea, eb] = await this.deps.embeddings.embedMany([`${a.title} ${a.summary}`, `${b.title} ${b.summary}`]);
        if (cosineSimilarity(ea!.vector, eb!.vector) < this.config.episodeMergeSimilarity) continue;
        const [loser, winner] = a.createdAt <= b.createdAt ? [b, a] : [a, b];
        await this.deps.sink.mergeEpisodes(loser.id, winner.id);
        loser.supersededBy = winner.id;
        outcomes.episodeMerges++;
        budget--;
      }
    }

    // --- 4. decay stale, uncorroborated semantic assumptions --------
    const staleBefore = this.deps.clock.epochMs() - this.config.staleDays * 86_400_000;
    for (const s of semantic) {
      if (budget <= 0) break;
      const last = Date.parse(s.lastReinforcedAt ?? s.createdAt);
      if (last >= staleBefore) continue;
      if (s.confidence <= 0.2) continue;
      await this.deps.sink.decaySemantic(s.id, Math.max(0.15, s.confidence - 0.15));
      outcomes.semanticDecayed++;
      budget--;
    }

    // --- 5. surface an insight ONLY if evidence-backed + significant --
    for (const [, agg] of statementCounts) {
      if (budget <= 0) break;
      if (agg.count < this.config.semanticRepetitionThreshold + 1) continue;
      const significance = Math.min(1, 0.4 + 0.1 * agg.count);
      if (significance < this.config.insightSignificanceFloor) continue;
      if (await this.deps.store.findInsightByStatement(principalId, `recurring: ${agg.sample}`)) continue;
      await this.deps.sink.recordInsight(runId, {
        statement: `recurring: ${agg.sample}`,
        significance,
        evidence: agg.evidence,
        provenance: prov,
      });
      outcomes.insights++;
      budget--;
    }

    const proposalsEmitted = this.config.maxProposalsPerRun - budget;
    await this.deps.store.finishRun(runId, this.deps.clock.nowIso(), inputsScanned, proposalsEmitted, outcomes);
    return { runId, inputsScanned, proposalsEmitted, outcomes };
  }
}

// --- helpers ---------------------------------------------------------
function zeroScore(): CandidateScore {
  return { novelty: 0, importance: 0, futureUtility: 0, objectiveRelevance: 0, confidence: 0, duplication: 0, sensitivity: 0, durability: 0, sourceQuality: 0, composite: 0 };
}
function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}
function candidateText(content: unknown): string {
  const r = asRecord(content);
  return String(r.summary ?? r.text ?? r.statement ?? r.title ?? JSON.stringify(content)).slice(0, 2000);
}
function candidateConfidence(content: unknown): number {
  const c = asRecord(content).confidence;
  return typeof c === 'number' ? c : 0.6;
}
function candidatePrivacy(content: unknown): 'PUBLIC' | 'INTERNAL' | 'SENSITIVE' | 'RESTRICTED' {
  const p = asRecord(content).privacyClass;
  return p === 'PUBLIC' || p === 'SENSITIVE' || p === 'RESTRICTED' ? p : 'INTERNAL';
}
function candidateParticipants(content: unknown): string[] {
  const p = asRecord(content).participants;
  return Array.isArray(p) ? p.map(String) : [];
}
function refsTouch(content: unknown, objectiveIds: Set<string>): boolean {
  if (objectiveIds.size === 0) return false;
  const r = asRecord(content);
  const refs = [
    ...(Array.isArray(r.objectiveIds) ? r.objectiveIds.map(String) : []),
    ...(typeof r.objectiveId === 'string' ? [r.objectiveId] : []),
    ...(Array.isArray(r.sourceEventIds) ? r.sourceEventIds.map(String) : []),
  ];
  return refs.some((x) => objectiveIds.has(x));
}
function looksDurable(text: string): boolean {
  return /\b(prefers?|always|never|deploy|procedure|runbook|decided|policy|convention|because|rule)\b/i.test(text);
}
function normStatement(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
}
function timeOverlap(a: { occurredFrom: string; occurredTo: string }, b: { occurredFrom: string; occurredTo: string }): boolean {
  return Date.parse(a.occurredFrom) <= Date.parse(b.occurredTo) && Date.parse(b.occurredFrom) <= Date.parse(a.occurredTo);
}
