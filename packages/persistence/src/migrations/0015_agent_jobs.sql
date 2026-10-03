-- Ownership: existing Kernel Agent Runtime. No prompt/context or credentials.
create table cognition.agent_jobs (
  job_id text primary key,
  agent_id text not null, principal_id text not null, correlation_id text not null,
  objective_id text, parent_job_id text references cognition.agent_jobs(job_id),
  task_class text not null, request_hash text not null,
  state text not null check (state in ('QUEUED','LEASED','RUNNING','WAITING','COMPLETE','BLOCKED','FAILED','CANCELLED')),
  lease_owner text, lease_expiry timestamptz, attempt integer not null default 0,
  wall_ms integer not null check (wall_ms > 0), context_units integer not null check (context_units >= 0),
  cost_limit double precision not null check (cost_limit >= 0),
  deadline timestamptz not null, worker_pid integer, model_route jsonb,
  inference_started boolean not null default false,
  created_at timestamptz not null default clock_timestamp(), started_at timestamptz,
  last_heartbeat timestamptz, finished_at timestamptz,
  proposal_count integer not null default 0, evidence_refs jsonb not null default '[]',
  result jsonb, error_code text
);
create index agent_jobs_active_idx on cognition.agent_jobs(state, lease_expiry);
create index agent_jobs_principal_idx on cognition.agent_jobs(principal_id, created_at desc);
create index agent_jobs_parent_idx on cognition.agent_jobs(parent_job_id);
