# Retrieval and persistence discrepancy — root cause

Owner evidence: career turn persisted 24 ids, follow-up persisted 0, personalised explanation persisted
0 while its diagnostic claimed 6 selected and 821 bytes.

## Root cause: the request and the diagnostic were two different selections

Not persistence, not the byte ceiling, not context compilation. Two selections ran, and only one of
them was used.

```ts
// request path (companion-service, before this fix)
selectMemories({ records: fresh, query: command.input, principalId, locality,
  categories: categoryHintFor(command.input) })   // no limit, no minScore, no diversify

// diagnostic path (recallDiagnostics)
selectMemories({ ...input, categories: input.categories ?? plan.categories ?? categoryHintFor(...),
  limit: budget.limit, minScore: ... })           // the intent's limit, threshold and categories
```

`categoryHintFor` returns a category list only for a handful of phrases. For
"Explain that in a way that suits how I learn best" it returns `undefined`, so the request path ran a
**pure lexical search at the default threshold of 0.4** — and a learning record that does not contain
the words "explain", "way" or "best" scores nothing. Zero selected, zero persisted, and the model
truthfully said it had never been told a learning style.

The diagnostic passed different arguments, so it reported six. Both numbers were real; only one
described what happened.

The follow-up failed for the same reason plus one more: `"What else haven't you mentioned?"` shares no
content words with any memory record, so lexically everything was irrelevant. The topic — the previous
question — was never part of the search.

That is also the answer to "do these share a common cause": **yes, one defect with two symptoms** —
selection was not driven by the retrieval intent, and the trace described a selection that was never
used.

## Correction

`memory-selection.ts` is now the single authoritative selection. `adaptiveMemorySelection()`:

- takes the intent plan as the source of categories, limit, threshold and diversity;
- lets an explicit, narrower query hint override categories, and nothing else;
- for `FOLLOW_UP`, scores against the previous turn's question plus the follow-up, so the topic is in
  the search;
- excludes records the conversation has already been given, and reports exhaustion honestly.

`CompanionService` calls it once. The context block, the persisted `memory_record_ids` and the trace
are all derived from that one object, so they cannot disagree again. The trace now reports candidates,
approved, cloud-ineligible, ceiling-exceeded, already-provided, budget-removed and selected counts, plus
block bytes — all computed from the same selection.

## Verified with synthetic records (production selection path)

| scenario | result |
|---|---|
| career recall | COMPREHENSIVE_RECALL, ≥4 career records, ids match the block, SENSITIVE excluded |
| follow-up | FOLLOW_UP, expands to records not already given, stays on career topic |
| follow-up, topic exhausted | empty block, `already_provided` exclusions, no invention |
| personalised explanation | PERSONALISED_EXPLANATION, learning record selected, career/business excluded |
| impersonal science question | GENERAL_KNOWLEDGE, zero selection |
| broad self-profile | PROFILE_OVERVIEW, ≥5 records across ≥3 categories, zero "irrelevant" |

## Broad self-profile intent

"Without me giving you any background, tell me who I am, what I've accomplished and what I'm working
towards" was a TARGETED_FACT with a limit of four — which is why 92 eligible records were all called
irrelevant and the answer was truncated twice. Triggers now cover "who I am", "what I've accomplished",
"what I'm working towards", "my background", "who am I" and similar, at PROFILE_OVERVIEW with a limit of
20 and the intent's own threshold, which also carries a 4096-token allowance.

## Remaining

- The browser journey is intermittently losing the **second** turn of a conversation: the Kernel refuses
  it with `NO_ROUTE 503` before any provider is contacted, while the first turn of the same conversation
  is fine. It reproduced in roughly half of the automated runs and not in the owner's live sessions.
  The new diagnostic is what makes it visible at all; I did not root-cause it in this pass.
- The diagnostic cannot yet report the effective output allowance or the correlation id at the
  inference-failure line; it now reports a safe subtype (`output_truncated`, `proposal_schema`,
  `repair_refused_protected`, `stream_incomplete`, `budget_exceeded`, `unclassified`) alongside the code.
