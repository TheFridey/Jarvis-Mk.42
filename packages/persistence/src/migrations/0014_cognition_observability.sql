alter table cognition.runs
  add column if not exists task_class text,
  add column if not exists privacy_class text,
  add column if not exists objective_ref text,
  add column if not exists workflow_ref text,
  add column if not exists routing_observability jsonb,
  add column if not exists usage_observability jsonb,
  add column if not exists first_token_at timestamptz;

comment on column cognition.runs.routing_observability is
  'Kernel-recorded, provider-secret-free routing observation returned by the Model Gateway; not an authority decision.';
