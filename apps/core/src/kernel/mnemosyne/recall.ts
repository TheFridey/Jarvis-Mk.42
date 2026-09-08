/**
 * `MemoryRecall` implementation (contract: memory-recall.ts, ADR-0023,
 * MNEMOSYNE_MODEL.md §7).
 *
 * Recall is ALWAYS top-k + a relevance floor — never "all relevant". Relevance
 * is a SEVEN-factor weighted composite; semantic similarity is ONE bounded
 * factor. Cosine distance does not dictate truth.
 *
 *   relevance = ( w_sim·sim + w_ent·entityOverlap + w_rec·recency + w_imp·importance
 *               + w_obj·objectiveRelevance + w_conf·confidence + w_src·sourceAuthority )
 *               / Σw
 *
 * Deviation from the doc's "one SQL query": pgvector nearest-neighbour selection
 * AND the scalar prefilter run in SQL (the expensive part); the seven-factor
 * blend is a pure function over the returned rows. Same behaviour, far less
 * chance of a silent SQL arithmetic bug in a Kernel read path. `w_sim` is
 * clamped in `applyWeightBounds` so a misconfigured weight cannot let similarity
 * dominate. `weightsUsed` is returned on every call for tuning (ADR-0023).
 */
import type {
  MemoryRecall,
  RecallQuery,
  RecallWeights,
  RecalledItem,
  Ulid,
} from '@jarvis/contracts';
import { cosineSimilarity } from '@jarvis/contracts';
import type { EmbeddingClient } from '@jarvis/contracts';
import type { Clock } from '../../runtime/clock.ts';
import type { MnemosyneStore } from './stores.ts';
import type { Sql } from '@jarvis/persistence';
import { toPgVector } from '../embedding/embedding-client.ts';

export const DEFAULT_RECALL_WEIGHTS: RecallWeights = {
  sim: 0.20,
  entity: 0.20,
  recency: 0.15,
  importance: 0.15,
  objective: 0.10,
  confidence: 0.10,
  sourceAuthority: 0.10,
};

/** Hard ceiling on the similarity weight (ADR-0023: "w_sim is bounded so
 *  similarity alone cannot dominate the composite"). */
export const MAX_SIM_WEIGHT = 0.35;

export function applyWeightBounds(w: RecallWeights): RecallWeights {
  return { ...w, sim: Math.min(w.sim, MAX_SIM_WEIGHT) };
}

const RECENCY_HALF_LIFE_MS = 14 * 24 * 3_600_000; // 14 days

function sourceAuthority(method: string | undefined): number {
  switch (method) {
    case 'assertion': return 1.0;
    case 'sensor': return 0.9;
    case 'system': return 0.75;
    case 'derivation': return 0.8;
    case 'retrieval': return 0.6;
    case 'inference': return 0.5;
    case 'model': return 0.5;
    default: return 0.5;
  }
}

function recency(nowMs: number, tIso: string): number {
  const age = Math.max(0, nowMs - Date.parse(tIso));
  return Math.pow(0.5, age / RECENCY_HALF_LIFE_MS);
}

function entityOverlap(rowEntities: string[], queryEntities: string[]): number {
  if (queryEntities.length === 0) return 0.3; // neutral when no entity scope
  const set = new Set(rowEntities);
  const hit = queryEntities.filter((e) => set.has(e)).length;
  return hit / queryEntities.length;
}

function objectiveRelevance(rowRefs: string[], objectiveIds: string[]): number {
  if (objectiveIds.length === 0) return 0.4;
  const set = new Set(rowRefs);
  return objectiveIds.some((o) => set.has(o)) ? 1 : 0.25;
}

interface Factors {
  sim: number; entity: number; recency: number; importance: number;
  objective: number; confidence: number; sourceAuthority: number;
}

export function composite(f: Factors, w: RecallWeights): number {
  const num =
    w.sim * f.sim + w.entity * f.entity + w.recency * f.recency + w.importance * f.importance +
    w.objective * f.objective + w.confidence * f.confidence + w.sourceAuthority * f.sourceAuthority;
  const den = w.sim + w.entity + w.recency + w.importance + w.objective + w.confidence + w.sourceAuthority;
  return den === 0 ? 0 : Math.max(0, Math.min(1, num / den));
}

interface VectorRow {
  id: string;
  cls: 'episodic' | 'semantic';
  text: string;
  refs: string[];
  importance: number;
  confidence: number;
  method: string | null;
  ts: string;
  embedding: string | null;
}

export class MemoryRecallService implements MemoryRecall {
  private readonly weights: RecallWeights;

  constructor(
    private readonly deps: {
      sql: Sql;
      store: MnemosyneStore;
      embeddings: EmbeddingClient;
      clock: Clock;
      weights?: RecallWeights;
    },
  ) {
    this.weights = applyWeightBounds(deps.weights ?? DEFAULT_RECALL_WEIGHTS);
  }

  async recall(query: RecallQuery): Promise<{ items: RecalledItem[]; weightsUsed: RecallWeights }> {
    const nowMs = this.deps.clock.epochMs();
    const { vector } = await this.deps.embeddings.embed(query.text);
    const classes = new Set(query.classes ?? ['episodic', 'semantic', 'procedural', 'preference']);
    const wantVector = classes.has('episodic') || classes.has('semantic');

    const scored: RecalledItem[] = [];

    if (wantVector) {
      const rows = await this.fetchVectorRows(query.principalId, vector, Math.max(query.k * 5, 20));
      for (const r of rows) {
        if (!classes.has(r.cls)) continue;
        const sim = r.embedding ? clamp01(cosineSimilarity(vector, parseVector(r.embedding))) : 0.3;
        const rel = composite(
          {
            sim,
            entity: entityOverlap(r.refs, query.entityIds ?? []),
            recency: recency(nowMs, r.ts),
            importance: r.importance,
            objective: objectiveRelevance(r.refs, query.objectiveIds ?? []),
            confidence: r.confidence,
            sourceAuthority: sourceAuthority(r.method ?? undefined),
          },
          this.weights,
        );
        if (rel < query.floor) continue;
        if (r.cls === 'episodic') {
          const ep = await this.deps.store.getEpisode(r.id);
          if (ep) scored.push({ class: 'episodic', item: ep, relevance: rel });
        } else {
          const sm = await this.deps.store.getSemantic(r.id);
          if (sm) scored.push({ class: 'semantic', item: sm, relevance: rel });
        }
      }
    }

    if (classes.has('procedural')) {
      for (const p of await this.deps.store.searchProcedures(query.principalId, firstKeyword(query.text), query.k)) {
        const rel = composite(
          { sim: 0.4, entity: 0.3, recency: recency(nowMs, p.updatedAt), importance: 0.6, objective: 0.4, confidence: 0.7, sourceAuthority: 0.8 },
          this.weights,
        );
        if (rel >= query.floor) scored.push({ class: 'procedural', item: p, relevance: rel });
      }
    }

    if (classes.has('preference')) {
      for (const pref of await this.deps.store.allPreferences(query.principalId)) {
        if (!query.text.toLowerCase().includes(pref.key.toLowerCase().split('.')[0] ?? pref.key.toLowerCase()) &&
            !pref.key.toLowerCase().includes(firstKeyword(query.text))) continue;
        const rel = composite(
          { sim: 0.4, entity: 0.3, recency: recency(nowMs, pref.updatedAt), importance: 0.5, objective: 0.4, confidence: pref.confidence, sourceAuthority: 0.8 },
          this.weights,
        );
        if (rel >= query.floor) scored.push({ class: 'preference', item: pref, relevance: rel });
      }
    }

    scored.sort((a, b) => b.relevance - a.relevance || a.item.id.localeCompare(b.item.id));
    return { items: scored.slice(0, query.k), weightsUsed: this.weights };
  }

  async entityMemory(entityId: Ulid, principalId: string, k: number): Promise<{ items: RecalledItem[] }> {
    const eps = await this.deps.store.episodesForEntity(principalId, entityId, k);
    const nowMs = this.deps.clock.epochMs();
    const items: RecalledItem[] = eps.map((item) => ({
      class: 'episodic' as const,
      item,
      relevance: composite(
        { sim: 0.5, entity: 1, recency: recency(nowMs, item.occurredTo), importance: item.salience, objective: 0.4, confidence: item.confidence, sourceAuthority: sourceAuthority(item.provenance.method) },
        this.weights,
      ),
    }));
    items.sort((a, b) => b.relevance - a.relevance);
    return { items: items.slice(0, k) };
  }

  private async fetchVectorRows(principalId: string, vector: number[], limit: number): Promise<VectorRow[]> {
    const q = this.deps.sql`${toPgVector(vector)}::vector`;
    return this.deps.sql<VectorRow[]>`
      (
        select id, 'episodic' as cls, (title || ' ' || summary) as text,
               (participants || source_event_ids) as refs, salience as importance, confidence,
               provenance->>'method' as method, occurred_to as ts, embedding::text as embedding
        from mnemosyne.episodes
        where principal_id = ${principalId} and archived_at is null
        order by (case when embedding is null then 1 else 0 end), embedding <=> ${q}, occurred_to desc
        limit ${limit}
      )
      union all
      (
        select id, 'semantic' as cls, statement as text, source_episode_ids as refs, relevance as importance,
               confidence, provenance->>'method' as method, coalesce(last_reinforced_at, created_at) as ts,
               embedding::text as embedding
        from mnemosyne.semantic
        where principal_id = ${principalId}
        order by (case when embedding is null then 1 else 0 end), embedding <=> ${q}, created_at desc
        limit ${limit}
      )`;
  }
}

function clamp01(n: number): number { return Math.max(0, Math.min(1, n)); }
function parseVector(s: string): number[] {
  return s.replace(/[[\]]/g, '').split(',').map(Number);
}
function firstKeyword(text: string): string {
  const w = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t.length > 3);
  return w[0] ?? text.toLowerCase();
}
