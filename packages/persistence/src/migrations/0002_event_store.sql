-- The append-only event store.
--
-- Partitioned BY LIST (retention_class). TRANSIENT is never persisted, so it
-- has no partition and a CHECK on the parent rejects it defensively.
-- Time-based sub-partitioning + partition-drop is a later optimization; MK.43
-- retention sweeps use bounded DELETEs (fine at human-scale volumes).

create sequence if not exists events.global_seq as bigint;

create table events.events (
  id                   text        not null,
  global_seq           bigint      not null default nextval('events.global_seq'),
  type                 text        not null,
  schema_version       integer     not null,
  retention_class      text        not null,
  time                 timestamptz not null,
  recorded_at          timestamptz not null default now(),
  source_node          text        not null,
  source_component     text        not null,
  subject_kind         text        not null,
  subject_id           text        not null,
  actor_kind           text        not null,
  actor_id             text        not null,
  actor_on_behalf_of   text,
  provenance           jsonb       not null,
  causation_id         text        not null,
  correlation_id       text        not null,
  principal_id         text        not null,
  privacy_class        text        not null,
  trace_id             text,
  location             jsonb,
  confidence           double precision,
  evidence             jsonb,
  expires_at           timestamptz,
  payload              jsonb       not null,
  meta                 jsonb,
  constraint events_pk primary key (retention_class, id),
  constraint events_retention_class_ck check (
    retention_class in ('OPERATIONAL','AUDIT','MEMORY_CANDIDATE','SECURITY','DIAGNOSTIC')
  )
) partition by list (retention_class);

create table events.events_operational      partition of events.events for values in ('OPERATIONAL');
create table events.events_audit            partition of events.events for values in ('AUDIT');
create table events.events_memory_candidate partition of events.events for values in ('MEMORY_CANDIDATE');
create table events.events_security         partition of events.events for values in ('SECURITY');
create table events.events_diagnostic       partition of events.events for values in ('DIAGNOSTIC');

create unique index events_global_seq_uq on events.events (retention_class, global_seq);
create index events_subject_idx      on events.events (subject_kind, subject_id, global_seq);
create index events_correlation_idx  on events.events (correlation_id);
create index events_causation_idx    on events.events (causation_id);
create index events_type_idx         on events.events (type, recorded_at);
create index events_recorded_at_idx  on events.events (recorded_at);

-- Transactional outbox: written in the SAME tx as the event + any state change.
create table events.outbox (
  id              bigserial   primary key,
  event_id        text        not null,
  created_at      timestamptz not null default now(),
  dispatched_at   timestamptz,
  attempts        integer     not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error      text
);
create index outbox_undispatched_idx on events.outbox (next_attempt_at)
  where dispatched_at is null;

-- Consumer idempotency ledger.
create table events.idempotency (
  consumer     text        not null,
  event_id     text        not null,
  processed_at timestamptz not null default now(),
  primary key (consumer, event_id)
);

-- Dead-letter store for events a consumer could not process within its retry budget.
create table events.dead_letter (
  id          bigserial   primary key,
  consumer    text        not null,
  event_id    text        not null,
  event       jsonb       not null,
  attempts    integer     not null,
  last_error  text        not null,
  created_at  timestamptz not null default now()
);
