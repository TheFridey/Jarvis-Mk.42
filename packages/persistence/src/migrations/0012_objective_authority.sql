alter table projections.objectives add column if not exists desired_state jsonb not null default '{}';
alter table projections.objectives add column if not exists next_evaluation_at timestamptz;
alter table projections.objectives add column if not exists constraints jsonb not null default '[]';
alter table projections.objectives add column if not exists authority jsonb not null default '{"mayReason":true,"mayPlan":true,"mayPropose":true,"mayExecute":false}';
