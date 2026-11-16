-- What each turn was actually given, so a follow-up can expand instead of repeating itself.
-- Ids only: a record's statement is never copied out of the memory table.
alter table experience.conversation_turns
  add column if not exists memory_record_ids text[] not null default '{}';
