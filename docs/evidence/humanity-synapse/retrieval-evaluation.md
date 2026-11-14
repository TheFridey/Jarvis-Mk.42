# Retrieval evaluation

Synthetic records only; no owner statement was read.

## Follow-up expansion

Selection receives the ids a conversation has already been given and excludes them
(`reason: 'already_provided'`). Verified: a first broad selection returns three ids; a follow-up with
those excluded returns none of them; a record that would otherwise score is reported as already
provided rather than silently repeated. When nothing new exists the block is empty, so the honest answer
is "nothing further", not a re-run of the same facts.

Ids are stored per turn (`memory_record_ids`, migration 0021), never statements. The Kernel probes for
the column once and degrades to no exclusion on an unmigrated database rather than failing a turn.

## Personalised explanation

"Explain that in a way that suits how I learn best" is `PERSONALISED_EXPLANATION`, limit 6, categories
`learning`, `communication`, `preference`. A plain chemistry question stays `GENERAL_KNOWLEDGE` with
limit 0. Both verified.

## Named entity precedence

"Tell me everything you know about Stigma eSports" is `ENTITY_DETAIL` (limit 12, diversified) because
the request is not self-referential. "...about me" and "...about my previous career" remain
`COMPREHENSIVE_RECALL` at 24. Both verified.

## Not changed

Record ceilings, diversity caps, byte ceilings and privacy filtering are unchanged. The 24-record
comprehensive answers the owner found useful still happen; only the cases where they were wrong moved.
