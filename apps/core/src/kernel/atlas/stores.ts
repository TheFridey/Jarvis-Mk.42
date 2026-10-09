import { domainFor, domainReadSql, domainWriteSql, readableDomains } from '../domains/scope.ts';
/**
 * ATLAS persistence — raw SQL over the `atlas.*` schema (ATLAS_MODEL.md §2,
 * migration 0005_atlas.sql).
 *
 * This is a repository, not the write boundary. The write boundary is the
 * Knowledge Ingestion mediator (ADR-0020): it is the only component handed an
 * `AtlasStore`. `AtlasQueryService` wraps the READ methods for cognition; the
 * agent facade never touches this class.
 *
 * `atlas.facts` holds only `status = 'active'` rows (CK `facts_status_active_ck`);
 * leaving `active` means DELETE from `facts` + INSERT into `facts_archive` in one
 * transaction (see `archiveFact`).
 */
import type { Sql } from '@jarvis/persistence';
import type {
  AtlasObservation,
  CausalHypothesis,
  Confidence,
  Entity,
  EntityRelationship,
  EntityType,
  Evidence,
  EvidenceKind,
  Fact,
  FactConflict,
  FactStatus,
  PrivacyClass,
  Provenance,
  RelationKind,
  RelationshipType,
  Timestamp,
  Ulid,
} from '@jarvis/contracts';
import type { EmbeddingVector } from '@jarvis/contracts';
import { toPgVector } from '../embedding/embedding-client.ts';

type EpistemicStatus = Fact['epistemicStatus'];
const j = (v: unknown): string => JSON.stringify(v ?? null);

// --- row shapes -------------------------------------------------------------
interface EntityRow {
  id: string; type: string; canonical_name: string; metadata: Record<string, unknown> | null;
  privacy_class: PrivacyClass; principal_id: string; domain_id: string; spatial_extent: Entity['spatialExtent'] | null;
  embedding_model_id: string | null; created_at: string; updated_at: string;
}
interface RelRow {
  id: string; from_entity_id: string; to_entity_id: string; type: string; provenance: Provenance;
  confidence: number; valid_from: string; valid_to: string | null; observed_at: string;
  principal_id: string; domain_id: string; created_at: string;
}
interface FactRow {
  id: string; subject_entity_id: string; attribute: string; predicate: string | null; value: unknown;
  epistemic_status: EpistemicStatus; provenance: Provenance; confidence: number; valid_from: string;
  valid_to: string | null; status: FactStatus; supersedes_fact_id: string | null;
  superseded_at: string | null; contradiction_of: string[]; privacy_class: PrivacyClass;
  principal_id: string; domain_id: string; created_at: string;
}
interface EvidenceRow {
  id: string; subject_kind: Evidence['subjectKind']; subject_id: string; kind: EvidenceKind;
  ref: string; weight: number | null; note: string | null; principal_id: string; domain_id: string;
}
interface ConflictRow {
  id: string; subject_entity_id: string; attribute: string; fact_id_a: string; fact_id_b: string;
  status: FactConflict['status']; principal_id: string; domain_id: string; recorded_at: string;
}
interface ObsRow {
  id: string; event_id: string; kind: string; summary: string; source: string; node: string;
  observed_at: string; confidence: number; location: { spaceId: string; ref?: string } | null;
  raw_ref: string | null; expires_at: string; promoted_to_fact_id: string | null; principal_id: string; domain_id: string;
}
interface CausalRow {
  id: string; cause_ref: string; effect_ref: string; relation_kind: RelationKind; confidence: number;
  evidence: string[]; method: string; valid_from: string; valid_to: string | null;
  status: CausalHypothesis['status']; principal_id: string; domain_id: string; created_at: string;
}

const iso = (v: string): string => new Date(v).toISOString();

function toEntity(r: EntityRow, aliases: string[]): Entity {
  return {
    id: r.id, type: r.type as EntityType, canonicalName: r.canonical_name, aliases,
    metadata: r.metadata ?? {}, privacyClass: r.privacy_class, domainId: r.domain_id, principalId: r.principal_id,
    ...(r.spatial_extent ? { spatialExtent: r.spatial_extent } : {}),
    createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
  };
}
function toRel(r: RelRow): EntityRelationship {
  return {
    id: r.id, fromEntityId: r.from_entity_id, toEntityId: r.to_entity_id, type: r.type as RelationshipType,
    provenance: r.provenance, confidence: r.confidence, validFrom: iso(r.valid_from),
    ...(r.valid_to ? { validTo: iso(r.valid_to) } : {}), observedAt: iso(r.observed_at),
  };
}
function toFact(r: FactRow): Fact {
  return {
    id: r.id, subjectEntityId: r.subject_entity_id, attribute: r.attribute, value: r.value,
    epistemicStatus: r.epistemic_status, provenance: r.provenance, confidence: r.confidence,
    validFrom: iso(r.valid_from), ...(r.valid_to ? { validTo: iso(r.valid_to) } : {}),
    ...(r.predicate ? { predicate: r.predicate } : {}), status: r.status, privacyClass: r.privacy_class,
    contradictionOf: r.contradiction_of ?? [],
    ...(r.superseded_at ? { supersededAt: iso(r.superseded_at) } : {}),
    ...(r.supersedes_fact_id ? { supersedesFactId: r.supersedes_fact_id } : {}),
    createdAt: iso(r.created_at),
  };
}
function toEvidence(r: EvidenceRow): Evidence {
  return {
    id: r.id, subjectKind: r.subject_kind, subjectId: r.subject_id, kind: r.kind, ref: r.ref,
    ...(r.weight != null ? { weight: r.weight } : {}), ...(r.note ? { note: r.note } : {}),
    domainId: r.domain_id, principalId: r.principal_id,
  };
}
function toObs(r: ObsRow): AtlasObservation {
  return {
    id: r.id, eventId: r.event_id, kind: r.kind, summary: r.summary, source: r.source, node: r.node,
    observedAt: iso(r.observed_at), confidence: r.confidence, ...(r.location ? { location: r.location } : {}),
    ...(r.raw_ref ? { rawRef: r.raw_ref } : {}), expiresAt: iso(r.expires_at),
    ...(r.promoted_to_fact_id ? { promotedToFactId: r.promoted_to_fact_id } : {}),
    domainId: r.domain_id, principalId: r.principal_id,
  };
}
function toCausal(r: CausalRow): CausalHypothesis {
  return {
    id: r.id, causeRef: r.cause_ref, effectRef: r.effect_ref, relationKind: r.relation_kind,
    confidence: r.confidence, evidence: r.evidence ?? [], method: r.method, validFrom: iso(r.valid_from),
    ...(r.valid_to ? { validTo: iso(r.valid_to) } : {}), status: r.status, domainId: r.domain_id, principalId: r.principal_id,
    createdAt: iso(r.created_at),
  };
}

export interface NewEntity {
  id: Ulid; type: EntityType; canonicalName: string; metadata?: Record<string, unknown>;
  privacyClass: PrivacyClass; principalId: string; spatialExtent?: Entity['spatialExtent'];
  embedding?: EmbeddingVector; embeddingModelId?: string;
}
export interface NewFact {
  id: Ulid; subjectEntityId: Ulid; attribute: string; predicate?: string; value: unknown;
  epistemicStatus: EpistemicStatus; provenance: Provenance; confidence: Confidence;
  validFrom: Timestamp; validTo?: Timestamp; supersedesFactId?: Ulid; contradictionOf?: Ulid[];
  privacyClass: PrivacyClass; principalId: string;
}
export interface NewRelationship {
  id: Ulid; fromEntityId: Ulid; toEntityId: Ulid; type: RelationshipType; provenance: Provenance;
  confidence: Confidence; validFrom: Timestamp; validTo?: Timestamp; observedAt: Timestamp; principalId: string;
}
export interface NewObservation {
  id: Ulid; eventId: Ulid; kind: string; summary: string; source: string; node: string;
  observedAt: Timestamp; confidence: number; location?: { spaceId: string; ref?: string };
  rawRef?: string; expiresAt: Timestamp; principalId: string;
}
export interface NewEvidence {
  id: Ulid; subjectKind: Evidence['subjectKind']; subjectId: Ulid; kind: EvidenceKind;
  ref: string; weight?: number; note?: string; principalId: string;
}
export interface NewCausal {
  id: Ulid; causeRef: string; effectRef: string; relationKind: RelationKind; confidence: Confidence;
  evidence: string[]; method: string; validFrom: Timestamp; validTo?: Timestamp; principalId: string;
}

export class AtlasStore {
  constructor(private readonly sql: Sql) {}

  // --- entities ----------------------------------------------------------
  async insertEntity(e: NewEntity): Promise<void> {
    const emb = e.embedding ? this.sql`${toPgVector(e.embedding)}::vector` : this.sql`null`;
    await this.sql`
      insert into atlas.entities
        (id, type, canonical_name, metadata, privacy_class, principal_id, spatial_extent,
         embedding, embedding_model_id, domain_id)
      values (${e.id}, ${e.type}, ${e.canonicalName}, ${j(e.metadata ?? {})}, ${e.privacyClass},
              ${e.principalId}, ${e.spatialExtent ? j(e.spatialExtent) : null}, ${emb},
              ${e.embeddingModelId ?? null}, ${domainFor(e.principalId)})`;
  }

  async updateEntityMetadata(id: Ulid, metadata: Record<string, unknown>, updatedAt: Timestamp): Promise<void> {
    await this.sql`update atlas.entities set metadata = ${j(metadata)}, updated_at = ${updatedAt} where ${domainWriteSql(this.sql, 'entities')} and id = ${id}`;
  }

  async addAlias(entityId: Ulid, alias: string, source: string): Promise<void> {
    await this.sql`
      insert into atlas.entity_aliases (entity_id, alias, source)
      values (${entityId}, ${alias}, ${source}) on conflict do nothing`;
  }

  async getEntity(id: Ulid): Promise<Entity | undefined> {
    const [r] = await this.sql<EntityRow[]>`select * from atlas.entities where ${domainReadSql(this.sql, 'entities')} and id = ${id}`;
    if (!r) return undefined;
    return toEntity(r, await this.aliasesFor(id));
  }

  async aliasesFor(entityId: Ulid): Promise<string[]> {
    const rows = await this.sql<{ alias: string }[]>`
      select a.alias from atlas.entity_aliases a join atlas.entities e on e.id=a.entity_id where ${domainReadSql(this.sql, 'e')} and a.entity_id = ${entityId} order by a.alias`;
    return rows.map((x) => x.alias);
  }

  async findEntityByName(principalId: string, name: string): Promise<Entity | undefined> {
    const [r] = await this.sql<EntityRow[]>`
      select * from atlas.entities
      where ${domainReadSql(this.sql, 'entities')} and principal_id = ${principalId} and domain_id = any(${readableDomains(principalId)}::text[]) and lower(canonical_name) = lower(${name}) limit 1`;
    if (!r) return undefined;
    return toEntity(r, await this.aliasesFor(r.id));
  }

  async findEntityByAlias(principalId: string, alias: string): Promise<Entity | undefined> {
    const [r] = await this.sql<EntityRow[]>`
      select e.* from atlas.entity_aliases a
      join atlas.entities e on e.id = a.entity_id
      where ${domainReadSql(this.sql, 'e')} and e.principal_id = ${principalId} and e.domain_id = any(${readableDomains(principalId)}::text[]) and lower(a.alias) = lower(${alias}) limit 1`;
    if (!r) return undefined;
    return toEntity(r, await this.aliasesFor(r.id));
  }

  /** Cosine-nearest entities above `minSimilarity` (ADR-0011: similarity is a
   *  threshold gate for resolution, never a truth oracle). */
  async nearestEntities(
    principalId: string, embedding: EmbeddingVector, minSimilarity: number, limit = 5,
  ): Promise<Array<{ entity: Entity; similarity: number }>> {
    const q = this.sql`${toPgVector(embedding)}::vector`;
    const rows = await this.sql<Array<EntityRow & { similarity: number }>>`
      select *, 1 - (embedding <=> ${q}) as similarity
      from atlas.entities
      where ${domainReadSql(this.sql, 'entities')} and principal_id = ${principalId} and domain_id = any(${readableDomains(principalId)}::text[]) and embedding is not null
      order by embedding <=> ${q}
      limit ${limit}`;
    const out: Array<{ entity: Entity; similarity: number }> = [];
    for (const r of rows) {
      if (r.similarity < minSimilarity) continue;
      out.push({ entity: toEntity(r, await this.aliasesFor(r.id)), similarity: r.similarity });
    }
    return out;
  }

  /** Token-OR match: any word of `text` (len >= 3) that appears in a canonical
   *  name or alias. A single joined substring would never match multi-word
   *  intents like "is the operator at their workstation". */
  async searchEntities(principalId: string, text: string, limit = 10): Promise<Entity[]> {
    const tokens = text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((t) => t.length >= 3);
    if (tokens.length === 0) return [];
    const patterns = tokens.map((t) => `%${t}%`);
    const rows = await this.sql<EntityRow[]>`
      select distinct e.* from atlas.entities e
      left join atlas.entity_aliases a on a.entity_id = e.id
      where ${domainReadSql(this.sql, 'e')} and e.principal_id = ${principalId} and domain_id = any(${readableDomains(principalId)}::text[])
        and (e.canonical_name ilike any(${patterns}) or a.alias ilike any(${patterns}))
      order by e.updated_at desc
      limit ${limit}`;
    return Promise.all(rows.map(async (r) => toEntity(r, await this.aliasesFor(r.id))));
  }

  // --- relationships ---------------------------------------------------
  async insertRelationship(r: NewRelationship): Promise<void> {
    await this.sql`
      insert into atlas.entity_relationships
        (id, from_entity_id, to_entity_id, type, provenance, confidence, valid_from, valid_to,
         observed_at, principal_id, domain_id)
      values (${r.id}, ${r.fromEntityId}, ${r.toEntityId}, ${r.type}, ${j(r.provenance)},
              ${r.confidence}, ${r.validFrom}, ${r.validTo ?? null}, ${r.observedAt}, ${r.principalId}, ${domainFor(r.principalId)})`;
  }

  async closeRelationship(id: Ulid, validTo: Timestamp): Promise<void> {
    await this.sql`update atlas.entity_relationships set valid_to = ${validTo} where ${domainWriteSql(this.sql, 'entity_relationships')} and id = ${id} and valid_to is null`;
  }

  async activeRelationshipLike(
    principalId: string, fromEntityId: Ulid, toEntityId: Ulid, type: string,
  ): Promise<EntityRelationship | undefined> {
    const [r] = await this.sql<RelRow[]>`
      select * from atlas.entity_relationships
      where ${domainReadSql(this.sql, 'entity_relationships')} and principal_id = ${principalId} and domain_id = any(${readableDomains(principalId)}::text[]) and from_entity_id = ${fromEntityId}
        and to_entity_id = ${toEntityId} and type = ${type} and valid_to is null
      order by valid_from desc limit 1`;
    return r ? toRel(r) : undefined;
  }

  async relationshipsFor(
    entityId: Ulid, opts: { at?: Timestamp; kinds?: string[] } = {},
  ): Promise<EntityRelationship[]> {
    const at = opts.at ?? null;
    const kinds = opts.kinds ?? null;
    const rows = await this.sql<RelRow[]>`
      select * from atlas.entity_relationships
      where ${domainReadSql(this.sql, 'entity_relationships')} and (from_entity_id = ${entityId} or to_entity_id = ${entityId})
        and (${at}::timestamptz is null or (valid_from <= ${at} and (valid_to is null or valid_to > ${at})))
        and (${kinds}::text[] is null or type = any(${kinds}::text[]))
      order by valid_from desc`;
    return rows.map(toRel);
  }

  // --- facts ---------------------------------------------------------
  async insertFact(f: NewFact): Promise<void> {
    await this.sql`
      insert into atlas.facts
        (id, subject_entity_id, attribute, predicate, value, epistemic_status, provenance, confidence,
         valid_from, valid_to, status, supersedes_fact_id, contradiction_of, privacy_class, principal_id, domain_id)
      values (${f.id}, ${f.subjectEntityId}, ${f.attribute}, ${f.predicate ?? null}, ${j(f.value)},
              ${f.epistemicStatus}, ${j(f.provenance)}, ${f.confidence}, ${f.validFrom},
              ${f.validTo ?? null}, 'active', ${f.supersedesFactId ?? null},
              ${f.contradictionOf ?? []}, ${f.privacyClass}, ${f.principalId}, ${domainFor(f.principalId)})`;
  }

  async getFact(id: Ulid): Promise<Fact | undefined> {
    const [r] = await this.sql<FactRow[]>`select * from atlas.facts where ${domainReadSql(this.sql, 'facts')} and id = ${id}`;
    if (r) return toFact(r);
    const [a] = await this.sql<FactRow[]>`select * from atlas.facts_archive where ${domainReadSql(this.sql, 'facts_archive')} and id = ${id}`;
    return a ? toFact(a) : undefined;
  }

  async activeFacts(principalId: string, subjectEntityId: Ulid, attribute?: string): Promise<Fact[]> {
    const attr = attribute ?? null;
    const rows = await this.sql<FactRow[]>`
      select * from atlas.facts
      where ${domainReadSql(this.sql, 'facts')} and principal_id = ${principalId} and domain_id = any(${readableDomains(principalId)}::text[]) and subject_entity_id = ${subjectEntityId}
        and (${attr}::text is null or attribute = ${attr})
      order by confidence desc, valid_from desc`;
    return rows.map(toFact);
  }

  async factsValidAt(
    principalId: string, subjectEntityId: Ulid, attribute: string | undefined, at: Timestamp,
  ): Promise<Fact[]> {
    const attr = attribute ?? null;
    const rows = await this.sql<FactRow[]>`
      select * from (
        select * from atlas.facts where ${domainReadSql(this.sql, 'facts')} and principal_id = ${principalId} and domain_id = any(${readableDomains(principalId)}::text[]) and subject_entity_id = ${subjectEntityId}
        union all
        select id, subject_entity_id, attribute, predicate, value, epistemic_status, provenance, confidence,
               valid_from, valid_to, status, supersedes_fact_id, superseded_at, contradiction_of,
               privacy_class, principal_id, created_at, domain_id
        from atlas.facts_archive where ${domainReadSql(this.sql, 'facts_archive')} and principal_id = ${principalId} and domain_id = any(${readableDomains(principalId)}::text[]) and subject_entity_id = ${subjectEntityId}
      ) all_facts
      where (${attr}::text is null or attribute = ${attr})
        and valid_from <= ${at} and (valid_to is null or valid_to > ${at})
      order by confidence desc`;
    return rows.map(toFact);
  }

  /** Ordered belief chain for one (entity, attribute), superseded rows included. */
  async factHistory(principalId: string, subjectEntityId: Ulid, attribute: string): Promise<Fact[]> {
    const rows = await this.sql<FactRow[]>`
      select * from (
        select * from atlas.facts
        where ${domainReadSql(this.sql, 'facts')} and principal_id = ${principalId} and domain_id = any(${readableDomains(principalId)}::text[]) and subject_entity_id = ${subjectEntityId} and attribute = ${attribute}
        union all
        select id, subject_entity_id, attribute, predicate, value, epistemic_status, provenance, confidence,
               valid_from, valid_to, status, supersedes_fact_id, superseded_at, contradiction_of,
               privacy_class, principal_id, created_at, domain_id
        from atlas.facts_archive
        where ${domainReadSql(this.sql, 'facts_archive')} and principal_id = ${principalId} and domain_id = any(${readableDomains(principalId)}::text[]) and subject_entity_id = ${subjectEntityId} and attribute = ${attribute}
      ) h
      order by valid_from asc, created_at asc`;
    return rows.map(toFact);
  }

  async factsChangedBetween(
    principalId: string, t1: Timestamp, t2: Timestamp, filter: { entityId?: Ulid; attribute?: string } = {},
  ): Promise<Fact[]> {
    const eid = filter.entityId ?? null;
    const attr = filter.attribute ?? null;
    const rows = await this.sql<FactRow[]>`
      select * from (
        select * from atlas.facts where ${domainReadSql(this.sql, 'facts')} and principal_id = ${principalId} and domain_id = any(${readableDomains(principalId)}::text[])
        union all
        select id, subject_entity_id, attribute, predicate, value, epistemic_status, provenance, confidence,
               valid_from, valid_to, status, supersedes_fact_id, superseded_at, contradiction_of,
               privacy_class, principal_id, created_at, domain_id
        from atlas.facts_archive where ${domainReadSql(this.sql, 'facts_archive')} and principal_id = ${principalId} and domain_id = any(${readableDomains(principalId)}::text[])
      ) c
      where (${eid}::text is null or subject_entity_id = ${eid})
        and (${attr}::text is null or attribute = ${attr})
        and (
          (valid_from >= ${t1} and valid_from < ${t2})
          or (valid_to is not null and valid_to >= ${t1} and valid_to < ${t2})
          or (superseded_at is not null and superseded_at >= ${t1} and superseded_at < ${t2})
        )
      order by valid_from asc`;
    return rows.map(toFact);
  }

  async recentActiveFacts(principalId: string, limit = 40): Promise<Fact[]> {
    const rows = await this.sql<FactRow[]>`
      select * from atlas.facts where ${domainReadSql(this.sql, 'facts')} and principal_id = ${principalId} and domain_id = any(${readableDomains(principalId)}::text[])
      order by created_at desc limit ${limit}`;
    return rows.map(toFact);
  }

  /** Move a fact out of the hot table. `insert ... delete` in one tx so the CK
   *  never sees a non-active row in `atlas.facts` (ATLAS_MODEL.md §2.3). */
  async archiveFact(id: Ulid, newStatus: Exclude<FactStatus, 'active'>, supersededAt: Timestamp): Promise<void> {
    await this.sql.begin(async (tx) => {
      const [r] = await tx<FactRow[]>`select * from atlas.facts where ${domainWriteSql(this.sql,'facts')} and id = ${id} for update`;
      if (!r) return;
      await tx`
        insert into atlas.facts_archive
          (id, subject_entity_id, attribute, predicate, value, epistemic_status, provenance, confidence,
           valid_from, valid_to, status, supersedes_fact_id, superseded_at, contradiction_of, privacy_class,
           principal_id, created_at, domain_id)
        values (${r.id}, ${r.subject_entity_id}, ${r.attribute}, ${r.predicate}, ${j(r.value)},
                ${r.epistemic_status}, ${j(r.provenance)}, ${r.confidence}, ${r.valid_from}, ${r.valid_to},
                ${newStatus}, ${r.supersedes_fact_id}, ${supersededAt}, ${r.contradiction_of},
                ${r.privacy_class}, ${r.principal_id}, ${r.created_at}, ${r.domain_id})`;
      await tx`delete from atlas.facts where ${domainWriteSql(this.sql, 'facts')} and id = ${id}`;
    });
  }

  async setFactContradictions(id: Ulid, contradictionOf: Ulid[]): Promise<void> {
    await this.sql`update atlas.facts set contradiction_of = ${contradictionOf} where ${domainWriteSql(this.sql, 'facts')} and id = ${id}`;
  }

  // --- evidence ----------------------------------------------------
  async insertEvidence(e: NewEvidence): Promise<void> {
    await this.sql`
      insert into atlas.evidence (id, subject_kind, subject_id, kind, ref, weight, note, principal_id, domain_id)
      values (${e.id}, ${e.subjectKind}, ${e.subjectId}, ${e.kind}, ${e.ref}, ${e.weight ?? null},
              ${e.note ?? null}, ${e.principalId}, ${domainFor(e.principalId)})`;
  }

  async evidenceFor(subjectId: Ulid): Promise<Evidence[]> {
    const rows = await this.sql<EvidenceRow[]>`
      select * from atlas.evidence where ${domainReadSql(this.sql, 'evidence')} and subject_id = ${subjectId} order by created_at asc`;
    return rows.map(toEvidence);
  }

  // --- conflicts -------------------------------------------------
  async openConflict(
    c: { id: Ulid; subjectEntityId: Ulid; attribute: string; factIdA: Ulid; factIdB: Ulid; principalId: string },
  ): Promise<void> {
    await this.sql`
      insert into atlas.conflicts (id, subject_entity_id, attribute, fact_id_a, fact_id_b, status, principal_id, domain_id)
      values (${c.id}, ${c.subjectEntityId}, ${c.attribute}, ${c.factIdA}, ${c.factIdB}, 'open', ${c.principalId}, ${domainFor(c.principalId)})`;
  }

  async resolveConflict(id: Ulid, status: Exclude<FactConflict['status'], 'open'>): Promise<void> {
    await this.sql`update atlas.conflicts set status = ${status} where ${domainWriteSql(this.sql, 'conflicts')} and id = ${id}`;
  }

  async openConflicts(principalId: string, subjectEntityId?: Ulid): Promise<FactConflict[]> {
    const eid = subjectEntityId ?? null;
    const rows = await this.sql<ConflictRow[]>`
      select * from atlas.conflicts
      where ${domainReadSql(this.sql, 'conflicts')} and principal_id = ${principalId} and domain_id = any(${readableDomains(principalId)}::text[]) and status = 'open'
        and (${eid}::text is null or subject_entity_id = ${eid})
      order by recorded_at desc`;
    return rows.map((r) => ({
      id: r.id, subjectEntityId: r.subject_entity_id, attribute: r.attribute, factIdA: r.fact_id_a,
      factIdB: r.fact_id_b, status: r.status, domainId: r.domain_id, principalId: r.principal_id, recordedAt: iso(r.recorded_at),
    }));
  }

  async countOpenConflicts(): Promise<number> {
    const [r] = await this.sql<{ n: string }[]>`select count(*)::text as n from atlas.conflicts where ${domainReadSql(this.sql, 'conflicts')} and status = 'open'`;
    return Number(r?.n ?? 0);
  }

  // --- observations --------------------------------------------
  async insertObservation(o: NewObservation): Promise<void> {
    await this.sql`
      insert into atlas.observations
        (id, event_id, kind, summary, source, node, observed_at, confidence, location, raw_ref,
         expires_at, principal_id, domain_id)
      values (${o.id}, ${o.eventId}, ${o.kind}, ${o.summary}, ${o.source}, ${o.node}, ${o.observedAt},
              ${o.confidence}, ${o.location ? j(o.location) : null}, ${o.rawRef ?? null}, ${o.expiresAt},
              ${o.principalId}, ${domainFor(o.principalId)})`;
  }

  async unpromotedObservations(
    principalId: string, kind: string, notExpiredAt: Timestamp,
  ): Promise<AtlasObservation[]> {
    const rows = await this.sql<ObsRow[]>`
      select * from atlas.observations
      where ${domainReadSql(this.sql, 'observations')} and principal_id = ${principalId} and domain_id = any(${readableDomains(principalId)}::text[]) and kind = ${kind}
        and promoted_to_fact_id is null and expires_at > ${notExpiredAt}
      order by observed_at desc`;
    return rows.map(toObs);
  }

  async distinctUnpromotedKinds(principalId: string, notExpiredAt: Timestamp): Promise<string[]> {
    const rows = await this.sql<{ kind: string }[]>`
      select distinct kind from atlas.observations
      where ${domainReadSql(this.sql, 'observations')} and principal_id = ${principalId} and domain_id = any(${readableDomains(principalId)}::text[]) and promoted_to_fact_id is null and expires_at > ${notExpiredAt}`;
    return rows.map((r) => r.kind);
  }

  async recentObservations(principalId: string, notExpiredAt: Timestamp, limit = 20): Promise<AtlasObservation[]> {
    const rows = await this.sql<ObsRow[]>`
      select * from atlas.observations
      where ${domainReadSql(this.sql, 'observations')} and principal_id = ${principalId} and domain_id = any(${readableDomains(principalId)}::text[]) and expires_at > ${notExpiredAt}
      order by observed_at desc limit ${limit}`;
    return rows.map(toObs);
  }

  async markObservationsPromoted(ids: Ulid[], factId: Ulid): Promise<void> {
    if (ids.length === 0) return;
    await this.sql`update atlas.observations set promoted_to_fact_id = ${factId} where ${domainWriteSql(this.sql, 'observations')} and id = any(${ids})`;
  }

  async expireObservations(now: Timestamp): Promise<number> {
    const rows = await this.sql`
      delete from atlas.observations where ${domainWriteSql(this.sql, 'observations')} and promoted_to_fact_id is null and expires_at <= ${now} returning id`;
    return rows.count;
  }

  // --- causal hypotheses -------------------------------------
  async insertCausal(c: NewCausal): Promise<void> {
    await this.sql`
      insert into atlas.causal_hypotheses
        (id, cause_ref, effect_ref, relation_kind, confidence, evidence, method, valid_from, valid_to,
         status, principal_id, domain_id)
      values (${c.id}, ${c.causeRef}, ${c.effectRef}, ${c.relationKind}, ${c.confidence}, ${c.evidence},
              ${c.method}, ${c.validFrom}, ${c.validTo ?? null}, 'active', ${c.principalId}, ${domainFor(c.principalId)})`;
  }

  async causalTouching(
    principalId: string, ref: string, direction: 'cause' | 'effect' | 'both',
  ): Promise<CausalHypothesis[]> {
    const rows = await this.sql<CausalRow[]>`
      select * from atlas.causal_hypotheses
      where ${domainReadSql(this.sql, 'causal_hypotheses')} and principal_id = ${principalId} and domain_id = any(${readableDomains(principalId)}::text[]) and status = 'active'
        and (
          (${direction} in ('cause','both') and cause_ref = ${ref})
          or (${direction} in ('effect','both') and effect_ref = ${ref})
        )
      order by created_at desc`;
    return rows.map(toCausal);
  }

  // --- forgetting (privacy deletion — MNEMOSYNE_MODEL.md §8 analogue) ---
  async forgetEntity(id: Ulid): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`delete from atlas.evidence where ${domainWriteSql(this.sql, 'evidence')} and subject_id in (select id from atlas.facts where subject_entity_id = ${id})`;
      await tx`delete from atlas.facts where ${domainWriteSql(this.sql, 'facts')} and subject_entity_id = ${id}`;
      await tx`delete from atlas.facts_archive where ${domainWriteSql(this.sql, 'facts_archive')} and subject_entity_id = ${id}`;
      await tx`delete from atlas.conflicts where ${domainWriteSql(this.sql, 'conflicts')} and subject_entity_id = ${id}`;
      await tx`delete from atlas.observations where ${domainWriteSql(this.sql, 'observations')} and promoted_to_fact_id is null and id = ${id}`;
      await tx`delete from atlas.entity_relationships where ${domainWriteSql(this.sql, 'entity_relationships')} and from_entity_id = ${id} or to_entity_id = ${id}`;
      await tx`delete from atlas.entities where ${domainWriteSql(this.sql, 'entities')} and id = ${id}`;
    });
  }

  async counts(): Promise<{ entities: number; facts: number; relationships: number; observations: number }> {
    const [r] = await this.sql<{ e: string; f: string; r: string; o: string }[]>`
      select
        (select count(*) from atlas.entities) as e,
        (select count(*) from atlas.facts) as f,
        (select count(*) from atlas.entity_relationships) as r,
        (select count(*) from atlas.observations) as o`;
    return {
      entities: Number(r?.e ?? 0), facts: Number(r?.f ?? 0),
      relationships: Number(r?.r ?? 0), observations: Number(r?.o ?? 0),
    };
  }
}
