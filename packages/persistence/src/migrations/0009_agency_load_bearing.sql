alter table agency.capability_versions add column if not exists probation boolean not null default false;
alter table agency.capability_versions add column if not exists active boolean not null default true;
alter table agency.invocations add column if not exists proposal_id text;
create unique index if not exists agency_invocations_proposal_id_uidx
  on agency.invocations(proposal_id) where proposal_id is not null;

create table if not exists agency.invocation_history (
  invocation_id text not null references agency.invocations(invocation_id) on delete cascade,
  ordinal bigserial,
  state text not null,
  at timestamptz not null,
  event_id text not null,
  primary key (invocation_id, ordinal),
  unique (event_id)
);

create index if not exists agency_approvals_invocation_idx on agency.approvals(invocation_id);
