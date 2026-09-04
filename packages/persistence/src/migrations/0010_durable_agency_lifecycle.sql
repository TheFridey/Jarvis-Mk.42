alter table agency.invocations
  add column if not exists session_id text,
  add column if not exists causation_id text,
  add column if not exists trace_id text,
  add column if not exists proposal jsonb,
  add column if not exists policy_decision jsonb,
  add column if not exists permission_decision jsonb,
  add column if not exists credential_lease_ref text,
  add column if not exists verification_metadata jsonb,
  add column if not exists rollback_metadata jsonb,
  add column if not exists recovery_state jsonb,
  add column if not exists final_outcome text,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists updated_at timestamptz not null default now();

alter table agency.approvals
  add column if not exists principal_id text,
  add column if not exists capability_id text,
  add column if not exists capability_version text,
  add column if not exists action text,
  add column if not exists input_hash text,
  add column if not exists expires_at timestamptz,
  add column if not exists nonce text,
  add column if not exists version integer not null default 1;

create unique index if not exists agency_approvals_nonce_uidx on agency.approvals(nonce) where nonce is not null;

alter table agency.resource_leases
  add column if not exists lease_id text,
  add column if not exists owner_id text,
  add column if not exists heartbeat_at timestamptz,
  add column if not exists version integer not null default 1;
update agency.resource_leases set lease_id=coalesce(lease_id, md5(resource_key || invocation_id)), owner_id=coalesce(owner_id, 'legacy'), heartbeat_at=coalesce(heartbeat_at, acquired_at);
create unique index if not exists agency_resource_leases_lease_id_uidx on agency.resource_leases(lease_id);

alter table agency.credential_grants add column if not exists revoked_at timestamptz;

create table if not exists agency.authority_tokens (
  token_hash text primary key,
  invocation_id text not null references agency.invocations(invocation_id) on delete cascade,
  grant_id text not null references agency.grants(id),
  grant_version integer not null,
  principal_id text not null,
  scopes text[] not null,
  mode text not null check (mode in ('dry-run','full')),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create or replace function agency.enforce_invocation_transition() returns trigger language plpgsql as $$
begin
  if tg_op='INSERT' then if new.state<>'PROPOSED' then raise exception 'invocation must start PROPOSED' using errcode='23514'; end if; return new; end if;
  if new.state = old.state then return new; end if;
  if not (
    (old.state='PROPOSED' and new.state in ('VALIDATED','REJECTED')) or
    (old.state='VALIDATED' and new.state in ('POLICY_CHECKED','REJECTED','DENIED')) or
    (old.state='POLICY_CHECKED' and new.state in ('AWAITING_APPROVAL','APPROVED','DENIED')) or
    (old.state='AWAITING_APPROVAL' and new.state in ('APPROVED','DENIED')) or
    (old.state='APPROVED' and new.state in ('SIMULATING','LEASE_ACQUIRED','EXECUTING','ABORTED','DENIED','CANCELLED')) or
    (old.state='LEASE_ACQUIRED' and new.state in ('EXECUTING','INTERRUPTED','ABORTED','DENIED')) or
    (old.state='SIMULATING' and new.state in ('SIMULATED','FAILED','ABORTED')) or
    (old.state='SIMULATED' and new.state in ('LEASE_ACQUIRED','EXECUTING','ABORTED','DENIED')) or
    (old.state='EXECUTING' and new.state in ('EXECUTED','VERIFYING','FAILED','INTERRUPTED','COMPENSATING','ROLLBACK_PENDING')) or
    (old.state='EXECUTED' and new.state in ('VERIFYING','UNVERIFIED','ROLLBACK_PENDING','INTERRUPTED')) or
    (old.state='VERIFYING' and new.state in ('VERIFIED','COMPLETED','UNVERIFIED','VERIFICATION_FAILED','ROLLBACK_PENDING','ROLLING_BACK','INTERRUPTED')) or
    (old.state='VERIFIED' and new.state in ('SUCCEEDED','COMPLETED')) or
    (old.state='ROLLBACK_PENDING' and new.state in ('ROLLING_BACK','ROLLBACK_FAILED')) or
    (old.state='ROLLING_BACK' and new.state in ('ROLLED_BACK','ROLLBACK_FAILED','VERIFICATION_FAILED')) or
    (old.state='COMPENSATING' and new.state in ('PARTIALLY_COMPLETED','ROLLBACK_PENDING')) or
    (old.state='INTERRUPTED' and new.state in ('LEASE_ACQUIRED','ROLLBACK_PENDING','UNVERIFIED','CANCELLED'))
  ) then raise exception 'illegal invocation transition % -> %', old.state, new.state using errcode='23514'; end if;
  new.updated_at=now(); return new;
end $$;
drop trigger if exists agency_invocation_transition_guard on agency.invocations;
create trigger agency_invocation_transition_guard before insert or update of state on agency.invocations for each row execute function agency.enforce_invocation_transition();

grant select, insert, update, delete on agency.authority_tokens to agency_rw;
