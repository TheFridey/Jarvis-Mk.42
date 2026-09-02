-- MNEMOSYNE — memory (docs/architecture/MNEMOSYNE_MODEL.md, ADR-0020).
-- Writers: the Kernel Knowledge Ingestion mediator ONLY.
-- Schema name is `mnemosyne` (ADR-0020 renames the older `memory` sketch).
-- NOT authoritative truth. Append + summarise + decay.

create schema if not exists mnemosyne;
create extension if not exists vector;

-- Episodic ------------------------------------------------------------------- --
create table if not exists mnemosyne.episodes (
  id                 text        primary key,
  kind               text        not null,
  title              text        not null,
  summary            text        not null,
  body_ref           text,
  occurred_from      timestamptz not null,
  occurred_to        timestamptz not null,
  participants       text[]      not null default '{}',
  source_event_ids   text[]      not null default '{}',
  salience           double precision not null default 0
                       check (salience >= 0 and salience <= 1),
  privacy_class      text        not null default 'INTERNAL'
                       check (privacy_class in ('PUBLIC','INTERNAL','SENSITIVE','RESTRICTED')),
  scene_ref          text,
  embedding          vector(1536),
  embedding_model_id text,
  principal_id       text        not null,
  created_at         timestamptz not null default now(),
  superseded_by      text,
  archived_at        timestamptz
);
create index if not exists episodes_recency_idx on mnemosyne.episodes (principal_id, occurred_to desc);
create index if not exists episodes_participants_idx on mnemosyne.episodes using gin (participants);
create index if not exists episodes_embedding_idx
  on mnemosyne.episodes using hnsw (embedding vector_cosine_ops);

-- Semantic ---------------------------------------------------------------- --
create table if not exists mnemosyne.semantic (
  id                 text        primary key,
  statement          text        not null,
  confidence         double precision not null check (confidence >= 0 and confidence <= 1),
  source_episode_ids text[]      not null default '{}',
  privacy_class      text        not null default 'INTERNAL'
                       check (privacy_class in ('PUBLIC','INTERNAL','SENSITIVE','RESTRICTED')),
  relevance          double precision not null default 0.5,
  embedding          vector(1536),
  embedding_model_id text,
  principal_id       text        not null,
  created_at         timestamptz not null default now(),
  last_reinforced_at timestamptz
);
create index if not exists semantic_embedding_idx
  on mnemosyne.semantic using hnsw (embedding vector_cosine_ops);
create index if not exists semantic_prune_idx on mnemosyne.semantic (principal_id, relevance);

-- Procedural ------------------------------------------------------------ --
create table if not exists mnemosyne.procedures (
  id                 text        primary key,
  name               text        not null,
  steps              jsonb       not null,
  version            integer     not null default 1,
  source_episode_ids text[]      not null default '{}',
  principal_id       text        not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  last_validated_at  timestamptz,
  unique (principal_id, name)
);

-- Preference (privacy capped at INTERNAL) ---------------------------- --
create table if not exists mnemosyne.preferences (
  id                 text        primary key,
  key                text        not null,
  value              jsonb       not null,
  privacy_class      text        not null default 'INTERNAL'
                       check (privacy_class in ('PUBLIC','INTERNAL')),
  confidence         double precision not null check (confidence >= 0 and confidence <= 1),
  source_episode_ids text[]      not null default '{}',
  principal_id       text        not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (principal_id, key)
);

-- Candidate pipeline ---------------------------------------------- --
create table if not exists mnemosyne.candidates (
  id              text        primary key,
  source_event_id text        not null,
  source_kind     text        not null,
  content         jsonb       not null,
  score           double precision,
  score_breakdown jsonb,
  disposition     text        not null default 'pending'
                    check (disposition in ('pending','accepted','merged','rejected','expired','deferred')),
  disposed_at     timestamptz,
  episode_id      text,
  principal_id    text        not null,
  created_at      timestamptz not null default now()
);
create index if not exists candidates_pending_idx on mnemosyne.candidates (created_at)
  where disposition = 'pending';

-- Consolidation run log ("DREAMING") ---------------------------- --
create table if not exists mnemosyne.consolidation_runs (
  id                text        primary key,
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  inputs_scanned    jsonb       not null default '{}',
  proposals_emitted integer     not null default 0,
  outcomes          jsonb       not null default '{}',
  principal_id      text        not null
);
create index if not exists consolidation_runs_recency_idx
  on mnemosyne.consolidation_runs (started_at desc);

-- Insights ------------------------------------------------------ --
create table if not exists mnemosyne.insights (
  id                   text        primary key,
  statement            text        not null,
  significance         double precision not null check (significance >= 0 and significance <= 1),
  evidence             text[]      not null,
  surfaced             boolean     not null default false,
  surfaced_at          timestamptz,
  superseded_by        text,
  consolidation_run_id text        not null,
  principal_id         text        not null,
  created_at           timestamptz not null default now(),
  constraint insights_evidence_nonempty_ck check (cardinality(evidence) > 0)
);
create index if not exists insights_unsurfaced_idx on mnemosyne.insights (significance desc)
  where surfaced = false;

-- Per-schema role (boundary proof — ADR-0020 §5).
do $$
begin
  if not exists (select from pg_roles where rolname = 'jarvis_mnemosyne') then
    create role jarvis_mnemosyne nologin;
  end if;
end
$$;
grant usage on schema mnemosyne to jarvis_mnemosyne;
grant select, insert, update, delete on all tables in schema mnemosyne to jarvis_mnemosyne;
alter default privileges in schema mnemosyne
  grant select, insert, update, delete on tables to jarvis_mnemosyne;
grant usage on schema events to jarvis_mnemosyne;
grant select on events.events to jarvis_mnemosyne;
-- Boundary: jarvis_mnemosyne is granted NOTHING on schema atlas, and vice versa.
