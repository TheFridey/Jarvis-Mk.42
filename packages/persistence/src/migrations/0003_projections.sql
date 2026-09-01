-- Projected State: materialised read models. Single-writer per read model
-- (STATE_MODEL.md sec 3). All rebuildable from events.events.

create table projections.state_slices (
  key                       text        primary key,
  value                     jsonb       not null,
  version                   integer     not null default 0,
  updated_at                timestamptz not null default now(),
  last_event_id             text,
  updated_by_correlation_id text
);

-- Monotonic global state version + replay checkpoint. Single row (id = 1).
create table projections.state_meta (
  id                  integer     primary key default 1,
  state_version       bigint      not null default 0,
  checkpoint_event_id text,
  updated_at          timestamptz not null default now(),
  constraint state_meta_singleton_ck check (id = 1)
);
insert into projections.state_meta (id) values (1) on conflict do nothing;

create table projections.snapshots (
  id                  bigserial   primary key,
  state_version       bigint      not null,
  taken_at            timestamptz not null default now(),
  checkpoint_event_id text,
  slices              jsonb       not null
);
create index snapshots_taken_at_idx on projections.snapshots (taken_at desc);

-- Per-projector checkpoint (last events.global_seq applied).
create table projections.checkpoints (
  projector       text        primary key,
  last_event_seq  bigint      not null default 0,
  updated_at      timestamptz not null default now()
);
