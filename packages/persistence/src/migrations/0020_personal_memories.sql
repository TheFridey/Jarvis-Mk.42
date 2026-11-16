-- Durable personal memory, owner-governed.
--
-- Private by default: a record is inert until a human approves it. There is no path from model
-- output to an approved row — approval is a separate write with its own review status.
-- Revocation is a timestamp, not a delete, because "we stopped using it" and "it never existed"
-- are different claims and only one of them is true.

create table if not exists experience.personal_memories (
  id                text primary key,
  principal_id      text not null,
  category          text not null,
  subject           text not null,
  statement         text not null,
  source            text not null,
  confidence        real not null default 0.5,
  privacy_class     text not null default 'SENSITIVE',
  cloud_eligible    boolean not null default false,
  review_status     text not null default 'pending',
  policy_version    integer not null default 1,
  recorded_at       timestamptz not null default now(),
  last_verified_at  timestamptz,
  superseded_by     text,
  revoked_at        timestamptz,
  revoked_reason    text,
  constraint personal_memories_status check (review_status in ('pending','approved','rejected')),
  constraint personal_memories_class check (privacy_class in ('PUBLIC','INTERNAL','SENSITIVE','RESTRICTED')),
  constraint personal_memories_confidence check (confidence >= 0 and confidence <= 1),
  constraint personal_memories_revocation check (revoked_at is null or revoked_reason is not null)
);

-- Retrieval always filters by principal; nothing reads across owners by accident.
create index if not exists personal_memories_principal_idx
  on experience.personal_memories (principal_id, review_status);

-- Selection must be able to exclude revoked rows cheaply.
create index if not exists personal_memories_live_idx
  on experience.personal_memories (principal_id) where revoked_at is null;

-- One subject may hold several statements over time; only one is live at a time.
create unique index if not exists personal_memories_one_live_subject
  on experience.personal_memories (principal_id, category, lower(subject))
  where revoked_at is null and superseded_by is null;
