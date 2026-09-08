/**
 * MNEMOSYNE persistence — raw SQL over `mnemosyne.*` (MNEMOSYNE_MODEL.md §3,
 * migration 0006_mnemosyne.sql).
 *
 * Repository only. The write boundary is the Knowledge Ingestion mediator
 * (ADR-0020); it is the only component handed a `MnemosyneStore`. `MemoryRecallService`
 * wraps the READ paths; the agent facade never touches this class.
 *
 * NOT authoritative truth: append + summarise + decay. Losing these rows loses
 * recall quality, not history.
 */
import type { Sql } from '@jarvis/persistence';
import type {
  CandidateDisposition,
  CandidateScore,
  Confidence,
  MemoryEpisode,
  Insight,
  MemoryCandidate,
  Preference,
  Procedure,
  ProcedureStep,
  Provenance,
  PrivacyClass,
  SemanticMemory,
  Timestamp,
  Ulid,
} from '@jarvis/contracts';
import type { EmbeddingVector } from '@jarvis/contracts';

/** MNEMOSYNE's episode type. `@jarvis/contracts` re-exports it as `MemoryEpisode`
 *  because `context-frame.ts` also has an `Episode`. */
type Episode = MemoryEpisode;
import { toPgVector } from '../embedding/embedding-client.ts';

const j = (v: unknown): string => JSON.stringify(v ?? null);
const iso = (v: string): string => new Date(v).toISOString();

interface EpisodeRow {
  id: string; kind: string; title: string; summary: string; body_ref: string | null;
  occurred_from: string; occurred_to: string; participants: string[]; source_event_ids: string[];
  salience: number; confidence: number; provenance: Provenance; privacy_class: PrivacyClass;
  scene_ref: string | null; principal_id: string; created_at: string; superseded_by: string | null;
  archived_at: string | null;
}
interface SemanticRow {
  id: string; statement: string; confidence: number; provenance: Provenance; source_episode_ids: string[];
  privacy_class: PrivacyClass; relevance: number; principal_id: string; created_at: string;
  last_reinforced_at: string | null;
}
interface ProcedureRow {
  id: string; name: string; steps: ProcedureStep[]; version: number; source_episode_ids: string[];
  principal_id: string; created_at: string; updated_at: string; last_validated_at: string | null;
}
interface PreferenceRow {
  id: string; key: string; value: unknown; privacy_class: 'PUBLIC' | 'INTERNAL'; confidence: number;
  source_episode_ids: string[]; principal_id: string; created_at: string; updated_at: string;
}
interface CandidateRow {
  id: string; source_event_id: string; source_kind: string; content: unknown; score: number | null;
  score_breakdown: CandidateScore | null; disposition: CandidateDisposition; disposed_at: string | null;
  episode_id: string | null; principal_id: string; created_at: string;
}
interface InsightRow {
  id: string; statement: string; significance: number; provenance: Provenance; evidence: string[];
  surfaced: boolean; surfaced_at: string | null; superseded_by: string | null;
  consolidation_run_id: string; principal_id: string; created_at: string;
}

function toEpisode(r: EpisodeRow): Episode {
  return {
    id: r.id, kind: r.kind, title: r.title, summary: r.summary,
    ...(r.body_ref ? { bodyRef: r.body_ref } : {}),
    occurredFrom: iso(r.occurred_from), occurredTo: iso(r.occurred_to),
    participants: r.participants ?? [], sourceEventIds: r.source_event_ids ?? [],
    salience: r.salience, confidence: r.confidence, provenance: r.provenance, privacyClass: r.privacy_class,
    ...(r.scene_ref ? { sceneRef: r.scene_ref } : {}),
    principalId: r.principal_id, createdAt: iso(r.created_at),
    ...(r.superseded_by ? { supersededBy: r.superseded_by } : {}),
    ...(r.archived_at ? { archivedAt: iso(r.archived_at) } : {}),
  };
}
function toSemantic(r: SemanticRow): SemanticMemory {
  return {
    id: r.id, statement: r.statement, confidence: r.confidence, provenance: r.provenance,
    sourceEpisodeIds: r.source_episode_ids ?? [], privacyClass: r.privacy_class, relevance: r.relevance,
    principalId: r.principal_id, createdAt: iso(r.created_at),
    ...(r.last_reinforced_at ? { lastReinforcedAt: iso(r.last_reinforced_at) } : {}),
  };
}
function toProcedure(r: ProcedureRow): Procedure {
  return {
    id: r.id, name: r.name, steps: r.steps ?? [], version: r.version,
    sourceEpisodeIds: r.source_episode_ids ?? [], principalId: r.principal_id,
    createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
    ...(r.last_validated_at ? { lastValidatedAt: iso(r.last_validated_at) } : {}),
  };
}
function toPreference(r: PreferenceRow): Preference {
  return {
    id: r.id, key: r.key, value: r.value, privacyClass: r.privacy_class, confidence: r.confidence,
    sourceEpisodeIds: r.source_episode_ids ?? [], principalId: r.principal_id,
    createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
  };
}
function toCandidate(r: CandidateRow): MemoryCandidate {
  return {
    id: r.id, sourceEventId: r.source_event_id, sourceKind: r.source_kind, content: r.content,
    ...(r.score_breakdown ? { score: r.score_breakdown } : {}), disposition: r.disposition,
    ...(r.disposed_at ? { disposedAt: iso(r.disposed_at) } : {}),
    ...(r.episode_id ? { episodeId: r.episode_id } : {}),
    principalId: r.principal_id, createdAt: iso(r.created_at),
  };
}
function toInsight(r: InsightRow): Insight {
  return {
    id: r.id, statement: r.statement, significance: r.significance, evidence: r.evidence ?? [],
    provenance: r.provenance, surfaced: r.surfaced,
    ...(r.surfaced_at ? { surfacedAt: iso(r.surfaced_at) } : {}),
    ...(r.superseded_by ? { supersededBy: r.superseded_by } : {}),
    consolidationRunId: r.consolidation_run_id, principalId: r.principal_id, createdAt: iso(r.created_at),
  };
}

export interface NewEpisode {
  id: Ulid; kind: string; title: string; summary: string; bodyRef?: string;
  occurredFrom: Timestamp; occurredTo: Timestamp; participants: Ulid[]; sourceEventIds: Ulid[];
  salience: number; confidence: Confidence; provenance: Provenance; privacyClass: PrivacyClass;
  sceneRef?: string; embedding?: EmbeddingVector; embeddingModelId?: string; principalId: string;
}
export interface NewSemantic {
  id: Ulid; statement: string; confidence: Confidence; provenance: Provenance; sourceEpisodeIds: Ulid[];
  privacyClass: PrivacyClass; relevance?: number; embedding?: EmbeddingVector; embeddingModelId?: string;
  principalId: string;
}
export interface NewProcedure {
  id: Ulid; name: string; steps: ProcedureStep[]; sourceEpisodeIds: Ulid[]; principalId: string;
}
export interface NewPreference {
  id: Ulid; key: string; value: unknown; privacyClass: 'PUBLIC' | 'INTERNAL'; confidence: Confidence;
  sourceEpisodeIds: Ulid[]; principalId: string;
}
export interface NewCandidate {
  id: Ulid; sourceEventId: Ulid; sourceKind: string; content: unknown; principalId: string;
}
export interface NewInsight {
  id: Ulid; statement: string; significance: number; provenance: Provenance; evidence: string[];
  consolidationRunId: Ulid; principalId: string;
}

export class MnemosyneStore {
  constructor(private readonly sql: Sql) {}

  // --- episodes -------------------------------------------------------
  async insertEpisode(e: NewEpisode): Promise<void> {
    const emb = e.embedding ? this.sql`${toPgVector(e.embedding)}::vector` : this.sql`null`;
    await this.sql`
      insert into mnemosyne.episodes
        (id, kind, title, summary, body_ref, occurred_from, occurred_to, participants, source_event_ids,
         salience, confidence, provenance, privacy_class, scene_ref, embedding, embedding_model_id, principal_id)
      values (${e.id}, ${e.kind}, ${e.title}, ${e.summary}, ${e.bodyRef ?? null}, ${e.occurredFrom},
              ${e.occurredTo}, ${e.participants}, ${e.sourceEventIds}, ${e.salience}, ${e.confidence},
              ${j(e.provenance)}, ${e.privacyClass}, ${e.sceneRef ?? null}, ${emb},
              ${e.embeddingModelId ?? null}, ${e.principalId})`;
  }

  async getEpisode(id: Ulid): Promise<Episode | undefined> {
    const [r] = await this.sql<EpisodeRow[]>`select * from mnemosyne.episodes where id = ${id}`;
    return r ? toEpisode(r) : undefined;
  }

  async recentEpisodes(principalId: string, since: Timestamp, limit = 100): Promise<Episode[]> {
    const rows = await this.sql<EpisodeRow[]>`
      select * from mnemosyne.episodes
      where principal_id = ${principalId} and archived_at is null and occurred_to >= ${since}
      order by occurred_to desc limit ${limit}`;
    return rows.map(toEpisode);
  }

  async episodesForEntity(principalId: string, entityId: Ulid, limit = 20): Promise<Episode[]> {
    const rows = await this.sql<EpisodeRow[]>`
      select * from mnemosyne.episodes
      where principal_id = ${principalId} and archived_at is null and ${entityId} = any(participants)
      order by occurred_to desc limit ${limit}`;
    return rows.map(toEpisode);
  }

  async supersedeEpisode(id: Ulid, bySupersedingId: Ulid, at: Timestamp): Promise<void> {
    await this.sql`
      update mnemosyne.episodes set superseded_by = ${bySupersedingId}, archived_at = ${at}
      where id = ${id} and superseded_by is null`;
  }

  // --- semantic -------------------------------------------------
  async insertSemantic(s: NewSemantic): Promise<void> {
    const emb = s.embedding ? this.sql`${toPgVector(s.embedding)}::vector` : this.sql`null`;
    await this.sql`
      insert into mnemosyne.semantic
        (id, statement, confidence, provenance, source_episode_ids, privacy_class, relevance, embedding,
         embedding_model_id, principal_id)
      values (${s.id}, ${s.statement}, ${s.confidence}, ${j(s.provenance)}, ${s.sourceEpisodeIds},
              ${s.privacyClass}, ${s.relevance ?? 0.5}, ${emb}, ${s.embeddingModelId ?? null}, ${s.principalId})`;
  }

  async findSemanticByStatement(principalId: string, statement: string): Promise<SemanticMemory | undefined> {
    const [r] = await this.sql<SemanticRow[]>`
      select * from mnemosyne.semantic
      where principal_id = ${principalId} and lower(statement) = lower(${statement}) limit 1`;
    return r ? toSemantic(r) : undefined;
  }

  async reinforceSemantic(id: Ulid, confidence: Confidence, at: Timestamp): Promise<void> {
    await this.sql`
      update mnemosyne.semantic
      set confidence = ${confidence}, relevance = least(1, relevance + 0.1), last_reinforced_at = ${at}
      where id = ${id}`;
  }

  async decaySemantic(id: Ulid, confidence: Confidence): Promise<void> {
    await this.sql`update mnemosyne.semantic set confidence = ${confidence}, relevance = greatest(0, relevance - 0.1) where id = ${id}`;
  }

  async getSemantic(id: Ulid): Promise<SemanticMemory | undefined> {
    const [r] = await this.sql<SemanticRow[]>`select * from mnemosyne.semantic where id = ${id}`;
    return r ? toSemantic(r) : undefined;
  }

  async allSemantic(principalId: string): Promise<SemanticMemory[]> {
    const rows = await this.sql<SemanticRow[]>`
      select * from mnemosyne.semantic where principal_id = ${principalId} order by created_at desc`;
    return rows.map(toSemantic);
  }

  // --- procedures --------------------------------------------
  async upsertProcedure(p: NewProcedure): Promise<{ id: Ulid; version: number }> {
    const [r] = await this.sql<{ id: string; version: number }[]>`
      insert into mnemosyne.procedures (id, name, steps, version, source_episode_ids, principal_id)
      values (${p.id}, ${p.name}, ${j(p.steps)}, 1, ${p.sourceEpisodeIds}, ${p.principalId})
      on conflict (principal_id, name) do update
        set steps = ${j(p.steps)}, version = mnemosyne.procedures.version + 1,
            source_episode_ids = ${p.sourceEpisodeIds}, updated_at = now()
      returning id, version`;
    return { id: r!.id, version: r!.version };
  }

  async getProcedure(principalId: string, name: string): Promise<Procedure | undefined> {
    const [r] = await this.sql<ProcedureRow[]>`
      select * from mnemosyne.procedures where principal_id = ${principalId} and name = ${name}`;
    return r ? toProcedure(r) : undefined;
  }

  async searchProcedures(principalId: string, text: string, limit = 5): Promise<Procedure[]> {
    const rows = await this.sql<ProcedureRow[]>`
      select * from mnemosyne.procedures
      where principal_id = ${principalId} and name ilike ${'%' + text + '%'}
      order by updated_at desc limit ${limit}`;
    return rows.map(toProcedure);
  }

  // --- preferences ----------------------------------------
  async upsertPreference(p: NewPreference): Promise<void> {
    await this.sql`
      insert into mnemosyne.preferences (id, key, value, privacy_class, confidence, source_episode_ids, principal_id)
      values (${p.id}, ${p.key}, ${j(p.value)}, ${p.privacyClass}, ${p.confidence}, ${p.sourceEpisodeIds}, ${p.principalId})
      on conflict (principal_id, key) do update
        set value = ${j(p.value)}, confidence = ${p.confidence}, updated_at = now()`;
  }

  async allPreferences(principalId: string): Promise<Preference[]> {
    const rows = await this.sql<PreferenceRow[]>`
      select * from mnemosyne.preferences where principal_id = ${principalId} order by key`;
    return rows.map(toPreference);
  }

  // --- candidates ------------------------------------
  async insertCandidate(c: NewCandidate): Promise<void> {
    await this.sql`
      insert into mnemosyne.candidates (id, source_event_id, source_kind, content, disposition, principal_id)
      values (${c.id}, ${c.sourceEventId}, ${c.sourceKind}, ${j(c.content)}, 'pending', ${c.principalId})`;
  }

  async pendingCandidates(principalId: string, limit = 200): Promise<MemoryCandidate[]> {
    const rows = await this.sql<CandidateRow[]>`
      select * from mnemosyne.candidates
      where principal_id = ${principalId} and disposition = 'pending'
      order by created_at asc limit ${limit}`;
    return rows.map(toCandidate);
  }

  async getCandidate(id: Ulid): Promise<MemoryCandidate | undefined> {
    const [r] = await this.sql<CandidateRow[]>`select * from mnemosyne.candidates where id = ${id}`;
    return r ? toCandidate(r) : undefined;
  }

  async disposeCandidate(
    id: Ulid, disposition: CandidateDisposition, score: CandidateScore, at: Timestamp, episodeId?: Ulid,
  ): Promise<void> {
    await this.sql`
      update mnemosyne.candidates
      set disposition = ${disposition}, score = ${score.composite}, score_breakdown = ${j(score)},
          disposed_at = ${at}, episode_id = ${episodeId ?? null}
      where id = ${id}`;
  }

  // --- consolidation runs ----------------------
  async startRun(id: Ulid, principalId: string, at: Timestamp): Promise<void> {
    await this.sql`
      insert into mnemosyne.consolidation_runs (id, started_at, principal_id) values (${id}, ${at}, ${principalId})`;
  }

  async finishRun(
    id: Ulid, at: Timestamp, inputsScanned: Record<string, number>, proposalsEmitted: number,
    outcomes: Record<string, unknown>,
  ): Promise<void> {
    await this.sql`
      update mnemosyne.consolidation_runs
      set finished_at = ${at}, inputs_scanned = ${j(inputsScanned)}, proposals_emitted = ${proposalsEmitted},
          outcomes = ${j(outcomes)}
      where id = ${id}`;
  }

  async lastRun(principalId: string): Promise<{ id: string; startedAt: string; finishedAt: string | null } | undefined> {
    const [r] = await this.sql<{ id: string; started_at: string; finished_at: string | null }[]>`
      select id, started_at, finished_at from mnemosyne.consolidation_runs
      where principal_id = ${principalId} order by started_at desc limit 1`;
    return r ? { id: r.id, startedAt: iso(r.started_at), finishedAt: r.finished_at ? iso(r.finished_at) : null } : undefined;
  }

  // --- insights ------------------------
  async insertInsight(i: NewInsight): Promise<void> {
    await this.sql`
      insert into mnemosyne.insights (id, statement, significance, provenance, evidence, consolidation_run_id, principal_id)
      values (${i.id}, ${i.statement}, ${i.significance}, ${j(i.provenance)}, ${i.evidence}, ${i.consolidationRunId}, ${i.principalId})`;
  }

  async unsurfacedInsights(principalId: string): Promise<Insight[]> {
    const rows = await this.sql<InsightRow[]>`
      select * from mnemosyne.insights
      where principal_id = ${principalId} and surfaced = false
      order by significance desc`;
    return rows.map(toInsight);
  }

  async markInsightSurfaced(id: Ulid, at: Timestamp): Promise<void> {
    await this.sql`update mnemosyne.insights set surfaced = true, surfaced_at = ${at} where id = ${id}`;
  }

  async findInsightByStatement(principalId: string, statement: string): Promise<Insight | undefined> {
    const [r] = await this.sql<InsightRow[]>`
      select * from mnemosyne.insights
      where principal_id = ${principalId} and lower(statement) = lower(${statement}) limit 1`;
    return r ? toInsight(r) : undefined;
  }

  // --- forgetting (MNEMOSYNE_MODEL.md §8: the one op that truly deletes) ---
  async forgetEpisode(id: Ulid): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`delete from mnemosyne.semantic where ${id} = any(source_episode_ids) and cardinality(source_episode_ids) = 1`;
      await tx`update mnemosyne.semantic set source_episode_ids = array_remove(source_episode_ids, ${id}) where ${id} = any(source_episode_ids)`;
      await tx`delete from mnemosyne.candidates where episode_id = ${id}`;
      await tx`delete from mnemosyne.episodes where id = ${id}`;
    });
  }

  async counts(): Promise<{ episodes: number; semantic: number; procedures: number; candidatesPending: number }> {
    const [r] = await this.sql<{ e: string; s: string; p: string; c: string }[]>`
      select
        (select count(*) from mnemosyne.episodes) as e,
        (select count(*) from mnemosyne.semantic) as s,
        (select count(*) from mnemosyne.procedures) as p,
        (select count(*) from mnemosyne.candidates where disposition = 'pending') as c`;
    return {
      episodes: Number(r?.e ?? 0), semantic: Number(r?.s ?? 0),
      procedures: Number(r?.p ?? 0), candidatesPending: Number(r?.c ?? 0),
    };
  }
}
