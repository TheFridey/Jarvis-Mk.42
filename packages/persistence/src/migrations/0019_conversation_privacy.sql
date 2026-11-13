-- Durable conversation privacy and explicit cloud authorisation.
--
-- Additive and backwards compatible. Existing rows keep privacy_class NULL, which the
-- policy reads as "unclassified" and therefore never eligible for a cloud provider.
-- Nothing is backfilled: a historical turn's classification cannot be invented, and a
-- regime that was never granted cannot be inferred.

alter table experience.conversation_turns
  add column if not exists privacy_class text
    check (privacy_class in ('PUBLIC','INTERNAL','SENSITIVE','RESTRICTED'));

-- The regime a turn was produced under. New turns are PRIVATE unless a live grant
-- authorised otherwise; existing rows default to PRIVATE, which is what they were.
alter table experience.conversation_turns
  add column if not exists privacy_regime text not null default 'PRIVATE'
    check (privacy_regime in ('PRIVATE','CLOUD_PERMITTED'));

create index if not exists conversation_turns_conversation
  on experience.conversation_turns(conversation_id, created_at);

-- An explicit, revocable authorisation for one conversation to use one named provider.
-- The UI is never the source of truth: this row is. Model output cannot create one.
create table if not exists experience.conversation_grants (
  grant_id        text        primary key,
  conversation_id text        not null,
  principal_id    text        not null,
  provider        text        not null,
  model           text        not null,
  purpose         text        not null check (purpose in ('conversation')),
  ceiling         text        not null check (ceiling in ('PUBLIC','INTERNAL','SENSITIVE','RESTRICTED')),
  policy_version  integer     not null,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz,
  revoked_at      timestamptz,
  revoked_by      text
);

create index if not exists conversation_grants_live
  on experience.conversation_grants(conversation_id, principal_id, revoked_at);

-- One live grant per conversation: a second authorisation must revoke the first, so a
-- conversation can never accumulate competing provider permissions.
create unique index if not exists conversation_grants_single_live
  on experience.conversation_grants(conversation_id)
  where revoked_at is null;
