create schema if not exists cognition;
create table if not exists cognition.runs (
  request_id text primary key, principal_id text not null, correlation_id text not null,
  agent_id text not null, model_id text, status text not null,
  input_hash text not null, response jsonb, error_code text,
  context_units integer not null default 0, output_units integer not null default 0,
  cost_estimate double precision not null default 0, latency_ms integer not null default 0,
  created_at timestamptz not null, finished_at timestamptz
);
create index if not exists cognition_runs_principal_idx on cognition.runs(principal_id, created_at desc);

create table if not exists projections.objectives (
  objective_id text primary key, principal_id text not null, parent_objective_id text,
  statement text not null, origin text not null, status text not null,
  success_criteria jsonb not null default '[]', child_objective_ids jsonb not null default '[]',
  dependencies jsonb not null default '[]', next_actions jsonb not null default '[]',
  priority integer not null, deadline timestamptz, provenance jsonb not null,
  correlation_id text not null, created_at timestamptz not null, updated_at timestamptz not null,
  version integer not null default 1
);
create table if not exists projections.objective_history (
  sequence bigserial primary key, objective_id text not null references projections.objectives(objective_id) on delete cascade,
  status text not null, reason text not null, at timestamptz not null
);
create index if not exists objective_history_objective_idx on projections.objective_history(objective_id, sequence);
