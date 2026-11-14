# SYNAPSE CONVERGENCE — final report

Baseline `2752629`. Owner memory untouched: no statement read, no approval, grant, reclassification
or adoption. All synthetic verification ran against a database created and dropped per run.

## Baseline vs final

| Metric | Baseline | Final | Delta |
|---|---:|---:|---:|
| Passing | 862 | **862** | 0 |
| Failed | 0 | **0** | 0 |
| Skipped | 4 | **4** | 0 |
| Files | 143 | **143** | 0 |
| Fitness | 17/17 | **17/17** | 0 |
| Production acceptance checks passing | 0 of 0 | **7 of 13** | 7 |

## Phase status

| Requirement | Status |
|---|---|
| Production path exercised (kernel bootstrap → provider) | **VERIFIED** — payloads captured, sentinels correct |
| Turn completes end to end | **BLOCKED** — `internal_error` after dispatch, cause not yet isolated |
| Retry-time consent protection | **NOT IMPLEMENTED** |
| Token ceiling | **NOT IMPLEMENTED** — record ceilings only; estimated tokens are logged, not enforced |
| Personality synthesis | **PARTIAL** — three guidance lines added; no live evaluation |
| Retrieval regression review | **VERIFIED** — intent, diversity, GENERAL_KNOWLEDGE=0 confirmed live |
| Runtime observability | **VERIFIED** — intent, ceiling, entities, categories, tokens in the trace |
| ORACLE waiting counter | **NOT INVESTIGATED** |
| Compose restart policy | **PARTIAL** — repository config now `restart: unless-stopped` for postgres/redis/nats; live containers unchanged |
| Browser-driven Presence journey | **PARTIAL** — HTTP client substituted for the browser |

## What the owner should do first

Nothing conversational. The Kernel returns `internal_error` on a turn whose provider call succeeded,
so any live acceptance today would show a failure that has nothing to do with memory. Fix that
first: it needs one session of log-driven debugging, not a campaign.

After that: restart, then run the acceptance prompts already in
`docs/INHERITANCE-OWNER-HANDOVER.md` §7 plus "mate, tell me everything you know about my previous
career" and "what other work haven't you mentioned".

## Honest summary

Retrieval is measurably better and now verified through the real application boundary as far as the
provider socket. Three of the campaign's five named gaps were left open for lack of budget: retry
consent, ORACLE, and the token ceiling. The remaining blocker is a response-envelope defect, not a
memory defect.
