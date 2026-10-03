-- Kernel-owned continuity. Devices store presentation preferences only.
create schema if not exists experience;
create table experience.conversation_turns (
  turn_id text primary key, conversation_id text not null, principal_id text not null,
  source_node_id text not null, input text not null, command_hash text not null, cognition_input text, answer text, response jsonb,
  status text not null check(status in ('running','completed','failed')),
  created_at timestamptz not null, finished_at timestamptz
);
create index conversation_turns_principal on experience.conversation_turns(principal_id,created_at desc);
create table experience.wall_presentations (
  node_id text primary key references nodes.registry(node_id), principal_id text not null,
  object_id text not null, scene_version bigint not null, expires_at timestamptz not null
);
