create schema if not exists agency;

create table agency.capabilities (
  id text primary key, latest_version text not null, description text not null,
  provider text not null, execution_environment text not null, trust_tier_min text not null,
  audit_policy jsonb not null, privacy_requirements jsonb not null,
  active boolean not null default true, created_at timestamptz not null default now()
);
create table agency.capability_versions (
  capability_id text not null references agency.capabilities(id), version text not null,
  manifest jsonb not null, adapter_artifact_hash text not null, registered_by text not null,
  registered_at timestamptz not null default now(), primary key (capability_id, version)
);
create table agency.policy_rules (
  id text not null, version integer not null, description text not null, predicate jsonb not null,
  effect text not null check (effect in ('ALLOW','DENY','REQUIRE_APPROVAL')),
  priority integer not null, enabled boolean not null default true,
  created_at timestamptz not null default now(), created_by text not null,
  primary key (id, version)
);
create table agency.grants (
  id text primary key, principal_id text not null, holder_kind text not null, holder_id text not null,
  scopes text[] not null default '{}', max_risk_without_live_approval text not null,
  may_proceed_without_live_approval boolean not null default false,
  resource_constraints jsonb not null default '[]', node_constraints text[] not null default '{}',
  time_windows jsonb not null default '[]', version integer not null default 1,
  issued_at timestamptz not null, expires_at timestamptz, revoked_at timestamptz
);
create table agency.invocations (
  invocation_id text primary key, capability_id text not null, capability_version text not null,
  action text not null, state text not null, correlation_id text not null, principal_id text not null,
  origin_actor jsonb not null, risk_class text not null, grant_id text, grant_version integer,
  approval_request_id text, resource_key text, lease_id text, input_hash text not null,
  before_state_ref text, predicted_effect_ref text, verify_report_ref text,
  started_at timestamptz, finished_at timestamptz, created_at timestamptz not null default now()
);
create index agency_invocations_state_idx on agency.invocations(state);
create index agency_invocations_correlation_idx on agency.invocations(correlation_id);
create table agency.approvals (
  id text primary key, invocation_id text not null references agency.invocations(invocation_id),
  risk_class text not null, summary text not null, simulated_effect jsonb, state text not null,
  required_authorisations integer not null, received_authorisations integer not null,
  approval_evidence jsonb, confirmation_phrase_hash text, requested_at timestamptz not null,
  decided_at timestamptz
);
create table agency.invocation_steps (
  invocation_id text not null references agency.invocations(invocation_id), ordinal integer not null,
  name text not null, state text not null, verify_report_ref text, compensated boolean not null default false,
  primary key (invocation_id, ordinal)
);
create table agency.resource_leases (
  resource_key text primary key, invocation_id text not null references agency.invocations(invocation_id),
  acquired_at timestamptz not null, expires_at timestamptz not null
);
create table agency.credential_grants (
  id text primary key, invocation_id text not null references agency.invocations(invocation_id),
  handle_id text not null, scope jsonb not null, mode text not null, kind text not null,
  minted_at timestamptz not null, expires_at timestamptz not null
);
create table agency.labs_runs (
  run_id text primary key, draft_id text not null, verdict text not null, report jsonb not null,
  artifact_hash text not null, started_at timestamptz not null, finished_at timestamptz not null
);
create table agency.security_alerts (
  id text primary key, severity text not null, detector text not null, finding jsonb not null,
  corroboration integer not null default 0, raised_at timestamptz not null, acknowledged_at timestamptz
);

do $$ begin
  if not exists (select from pg_roles where rolname = 'agency_rw') then create role agency_rw nologin; end if;
end $$;
grant usage on schema agency to agency_rw;
grant select, insert, update, delete on all tables in schema agency to agency_rw;
alter default privileges in schema agency grant select, insert, update, delete on tables to agency_rw;
grant usage on schema events to agency_rw;
grant select on events.events to agency_rw;
