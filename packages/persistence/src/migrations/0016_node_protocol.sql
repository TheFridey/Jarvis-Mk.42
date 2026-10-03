-- Connection fencing survives Kernel restart. Receipts and events commit together.
create table nodes.connections (
  node_id text primary key references nodes.registry(node_id),
  epoch bigint not null default 0,
  session_id text,
  attached_at timestamptz not null default now(),
  connected boolean not null default false
);
create table nodes.operation_receipts (
  node_id text not null references nodes.registry(node_id),
  operation_id text not null,
  request_hash text not null,
  event_id text not null,
  created_at timestamptz not null,
  primary key(node_id, operation_id)
);
