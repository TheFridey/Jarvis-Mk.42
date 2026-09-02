-- ATLAS — the temporal world model (docs/architecture/ATLAS_MODEL.md, ADR-0020).
-- Writers: the Kernel Knowledge Ingestion mediator ONLY.
-- Schema name is `atlas` (ADR-0020 renames the older `world_model` sketch).

create schema if not exists atlas;
create extension if not exists vector;

-- Entities ---------------------------------------------------------------------
create table if not exists atlas.entities (
  id             text        primary key,
  type           text        not null,
  canonical_name text        not null,
  metadata       jsonb       not null default '{}',
  privacy_class  text        not null default 'INTERNAL'
                   check (privacy_class in ('PUBLIC','INTERNAL','SENSITIVE','RESTRICTED')),
  principal_id   text        not null,
  spatial_extent jsonb,
  -- Entity-resolution embedding (ADR-0011). Dim is model-dependent; 1536 =
  -- text-embedding-3-small. Re-embed on model change (store the model id).
  embedding          vector(1536),
  embedding_model_id text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists entities_type_idx on atlas.entities (principal_id, type);
create index if not exists entities_name_idx on atlas.entities (principal_id, lower(canonical_name));
create index if not exists entities_embedding_idx
  on atlas.entities using hnsw (embedding vector_cosine_ops);

-- Normalised aliases (assembled into Entity.aliases[] on read; carries source). --
create table if not exists atlas.entity_aliases (
  entity_id  text        not null references atlas.entities(id) on delete cascade,
  alias      text        not null,
  source     text        not null default 'unknown',
  created_at timestamptz not null default now(),
  primary key (entity_id, alias)
);

-- Relationships (first-class, temporal) --------------------------------------- --
create table if not exists atlas.entity_relationships (
  id             text        primary key,
  from_entity_id text        not null references atlas.entities(id),
  to_entity_id   text        not null references atlas.entities(id),
  type           text        not null,
  provenance     jsonb       not null,
  confidence     double precision not null check (confidence >= 0 and confidence <= 1),
  valid_from     timestamptz not null default now(),
  valid_to       timestamptz,
  observed_at    timestamptz not null default now(),
  principal_id   text        not null,
  created_at     timestamptz not null default now()
);
create index if not exists rel_from_idx on atlas.entity_relationships (from_entity_id, type);
create index if not exists rel_to_idx   on atlas.entity_relationships (to_entity_id, type);
create index if not exists rel_valid_idx on atlas.entity_relationships (valid_from, valid_to);

-- Facts (hot: status = 'active' only) --------------------------------------- --
create table if not exists atlas.facts (
  id                 text        primary key,
  subject_entity_id  text        not null references atlas.entities(id),
  attribute          text        not null,
  predicate          text,
  value              jsonb       not null,
  epistemic_status   text        not null
                       check (epistemic_status in
                         ('observed','asserted','retrieved','inferred','predicted','derived')),
  provenance         jsonb       not null,
  confidence         double precision not null check (confidence >= 0 and confidence <= 1),
  valid_from         timestamptz not null default now(),
  valid_to           timestamptz,
  status             text        not null default 'active'
                       check (status in ('active','superseded','retracted','expired')),
  supersedes_fact_id text,
  superseded_at      timestamptz,
  contradiction_of   text[]      not null default '{}',
  privacy_class      text        not null default 'INTERNAL'
                       check (privacy_class in ('PUBLIC','INTERNAL','SENSITIVE','RESTRICTED')),
  principal_id       text        not null,
  created_at         timestamptz not null default now(),
  constraint facts_status_active_ck check (status = 'active')
);
create index if not exists facts_subject_attr_idx
  on atlas.facts (subject_entity_id, attribute);
create index if not exists facts_valid_idx on atlas.facts (valid_from, valid_to);

-- Archive: same shape, status <> 'active'. A job moves rows here (no
-- declarative partitioning — bounded moves at human-scale volume, per the
-- events-table precedent in migrator.ts).
create table if not exists atlas.facts_archive (
  id                 text        primary key,
  subject_entity_id  text        not null,
  attribute          text        not null,
  predicate          text,
  value              jsonb       not null,
  epistemic_status   text        not null,
  provenance         jsonb       not null,
  confidence         double precision not null,
  valid_from         timestamptz not null,
  valid_to           timestamptz,
  status             text        not null
                       check (status in ('superseded','retracted','expired')),
  supersedes_fact_id text,
  superseded_at      timestamptz not null,
  contradiction_of   text[]      not null default '{}',
  privacy_class      text        not null,
  principal_id       text        not null,
  created_at         timestamptz not null,
  archived_at        timestamptz not null default now()
);
create index if not exists facts_archive_subject_idx
  on atlas.facts_archive (subject_entity_id, attribute, valid_from);

-- Evidence graph (facts AND relationships) --------------------------------- --
create table if not exists atlas.evidence (
  id           text        primary key,
  subject_kind text        not null check (subject_kind in ('fact','relationship','causal_hypothesis')),
  subject_id   text        not null,
  kind         text        not null
                 check (kind in ('observation','source_document','parent_fact',
                                 'principal_assertion','inference_run','episode')),
  ref          text        not null,
  weight       double precision,
  note         text,
  principal_id text        not null,
  created_at   timestamptz not null default now()
);
create index if not exists evidence_subject_idx on atlas.evidence (subject_kind, subject_id);

-- Conflicts (recorded, not resolved by overwrite — L16) ------------------- --
create table if not exists atlas.conflicts (
  id                text        primary key,
  subject_entity_id text        not null references atlas.entities(id),
  attribute         text        not null,
  fact_id_a         text        not null,
  fact_id_b         text        not null,
  status            text        not null default 'open'
                      check (status in ('open','resolved_by_recency','resolved_by_authority',
                                        'resolved_by_principal','accepted_ambiguity')),
  principal_id      text        not null,
  recorded_at       timestamptz not null default now()
);
create index if not exists conflicts_open_idx
  on atlas.conflicts (subject_entity_id, attribute) where status = 'open';

-- Observation index (raw signal events expire; this row persists) --------- --
create table if not exists atlas.observations (
  id                  text        primary key,
  event_id            text        not null,
  kind                text        not null,
  summary             text        not null,
  source              text        not null,
  node                text        not null,
  observed_at         timestamptz not null,
  confidence          double precision not null,
  location            jsonb,
  raw_ref             text,
  expires_at          timestamptz not null,
  promoted_to_fact_id text,
  principal_id        text        not null,
  created_at          timestamptz not null default now()
);
create index if not exists observations_expiry_idx on atlas.observations (expires_at)
  where promoted_to_fact_id is null;
create index if not exists observations_kind_idx on atlas.observations (kind, observed_at desc);

-- Causal hypotheses (foundations only — ADR-0021) ------------------------ --
create table if not exists atlas.causal_hypotheses (
  id            text        primary key,
  cause_ref     text        not null,
  effect_ref    text        not null,
  relation_kind text        not null
                  check (relation_kind in ('chronological','correlated',
                                           'hypothesised_cause','established_cause')),
  confidence    double precision not null check (confidence >= 0 and confidence <= 1),
  evidence      text[]      not null default '{}',
  method        text        not null,
  valid_from    timestamptz not null default now(),
  valid_to      timestamptz,
  status        text        not null default 'active'
                  check (status in ('active','retracted','superseded')),
  principal_id  text        not null,
  created_at    timestamptz not null default now()
);
create index if not exists causal_cause_idx  on atlas.causal_hypotheses (cause_ref);
create index if not exists causal_effect_idx on atlas.causal_hypotheses (effect_ref);

-- Per-schema role (boundary proof — ADR-0020 §5, DATA_OWNERSHIP.md §3).
-- Forward-looking: MK.43 still connects as one role; the service split binds to
-- this. Guarded create so the migration is idempotent across test containers.
do $$
begin
  if not exists (select from pg_roles where rolname = 'jarvis_atlas') then
    create role jarvis_atlas nologin;
  end if;
end
$$;
grant usage on schema atlas to jarvis_atlas;
grant select, insert, update, delete on all tables in schema atlas to jarvis_atlas;
alter default privileges in schema atlas
  grant select, insert, update, delete on tables to jarvis_atlas;
grant usage on schema events to jarvis_atlas;
grant select on events.events to jarvis_atlas;
