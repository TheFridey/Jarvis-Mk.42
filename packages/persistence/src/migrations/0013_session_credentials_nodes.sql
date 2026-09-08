create table identity.access_credentials (
  id text primary key,
  secret_hash text not null unique,
  identity_id text not null references identity.identities(id),
  principal_id text not null references identity.principals(id),
  session_id text not null references session.sessions(id),
  node_id text not null,
  scopes text[] not null,
  auth_strength text not null check (auth_strength in ('bootstrap','single_factor','strong')),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  generation integer not null default 1,
  revoked_at timestamptz
);
create index access_credentials_session_idx on identity.access_credentials(session_id) where revoked_at is null;
create index access_credentials_identity_idx on identity.access_credentials(identity_id) where revoked_at is null;
create index access_credentials_node_idx on identity.access_credentials(node_id) where revoked_at is null;

create schema if not exists nodes;
create table nodes.registry (
  node_id text primary key,
  identity_id text not null references identity.identities(id),
  principal_id text not null references identity.principals(id),
  node_type text not null,
  trust_tier text not null check (trust_tier in ('kernel-local','owned-secure','owned-mobile','guest')),
  capabilities text[] not null default '{}', sensors text[] not null default '{}', outputs text[] not null default '{}',
  location text, software_version text not null, protocol_version text not null,
  public_key_fingerprint text not null unique, previous_key_fingerprint text, previous_key_expires_at timestamptz,
  status text not null check (status in ('pending','connected','degraded','disconnected','revoked','isolated')),
  enrolled_at timestamptz not null, last_seen_at timestamptz, health jsonb not null default '{}',
  version integer not null default 1, revoked_at timestamptz
);
create table nodes.enrollment_tokens (
  token_hash text primary key, principal_id text not null references identity.principals(id),
  trust_ceiling text not null, expires_at timestamptz not null, used_at timestamptz
);
