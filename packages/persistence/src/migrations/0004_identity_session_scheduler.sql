-- Identity Manager (multi-user from the schema down, L34).
create table identity.principals (
  id           text        primary key,
  display_name text        not null,
  is_operator  boolean     not null default false,
  created_at   timestamptz not null default now(),
  disabled_at  timestamptz
);

create table identity.identities (
  id           text        primary key,
  kind         text        not null check (kind in ('principal','device','node','service')),
  principal_id text        not null references identity.principals(id),
  external_ref text        not null,
  display_name text        not null,
  trust        text        not null check (trust in ('untrusted','provisional','trusted','verified')),
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  unique (kind, external_ref)
);
create index identities_principal_idx on identity.identities (principal_id);

create table identity.credentials (
  identity_id text        not null references identity.identities(id),
  method      text        not null,
  secret_hash text        not null,
  created_at  timestamptz not null default now(),
  primary key (identity_id, method)
);

-- Session Manager.
create table session.sessions (
  id                       text        primary key,
  type                     text        not null,
  principal_id             text        not null,
  nodes                    jsonb       not null default '[]',
  state                    text        not null,
  started_at               timestamptz not null default now(),
  ended_at                 timestamptz,
  last_activity_at         timestamptz not null default now(),
  opened_by_correlation_id text        not null,
  parent_session_id        text,
  handoff                  jsonb,
  context_ref              text,
  version                  integer     not null default 0
);
create index sessions_principal_idx on session.sessions (principal_id);
create index sessions_state_idx on session.sessions (state) where state <> 'ended';

-- Scheduler job history (internal routines only).
create table scheduler.job_runs (
  id            text        primary key,
  schedule_id   text        not null,
  status        text        not null,
  attempt       integer     not null default 0,
  scheduled_for timestamptz not null,
  started_at    timestamptz,
  finished_at   timestamptz,
  error         text
);
create index job_runs_schedule_idx on scheduler.job_runs (schedule_id, scheduled_for desc);
