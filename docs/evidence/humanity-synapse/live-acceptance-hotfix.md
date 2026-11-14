# LIVE ACCEPTANCE - final correction

Baseline `bb21aaf`, superseded by `5e09f76` and committed verification work after it. Owner records,
approvals, classifications and grants untouched.

## Defects found (as reported, then corrected)

| # | Reported | Actual |
|---|---|---|
| 1 | CompanionService may omit `memoryBearing` | It did. Nothing in production ever set it. |
| 2 | Gateway refuses fallback when protected | It never read the header; the field was only set in-process by tests. |
| 3 | AgentRuntime repairs malformed output | True, and unprotected-request-only reasoning did not cover it. |
| 4 | 422 on a deep reflection | Output ceiling 2000 tokens; a deep answer was truncated and correctly called invalid. |
| 5 | Follow-up repeated the same facts | Selection had no notion of what the conversation already knew. |
| 6 | Personalised explanation read as general knowledge | True. |
| 7 | Named entity read as profile recall | True. |
| 8 | ORACLE counter grows | Projection counted all history and let finished jobs present as active. |

## Corrections

Kernel-side classification (`carriesPersonalContext`), header read with fail-safe default in the
Gateway, format repair refused for protected requests, per-intent output allowances under a raised
ceiling, classified diagnostics, frontend error classification, additive follow-up via
`memory_record_ids` (migration 0021), personalised-explanation intent, entity precedence, and an ORACLE
projection that separates outstanding work from history.

## Verification executed in this continuation

| check | result |
|---|---|
| Browser journey (Chrome + CDP, real Presence) | **22/22, exit 0** |
| Convergence acceptance harness | **13/13, exit 0** |
| Migration 0021 on an isolated PostgreSQL | applied, column present, database dropped |
| Full suite with `JARVIS_DB_URL` | **905 passed, 4 skipped, 0 failed, 150 files, exit 0** |
| Typecheck / lint / fitness | clean / clean / 17/17 |
| Wire counts, protected vs unprotected | 1 vs 2 arrivals; truncation classified after 1 |

## Status

VERIFIED: disclosure classification and propagation to the Gateway, format-repair closure, truncation
classification, output allowances on the wire, diagnostics, frontend classification, retrieval
corrections, ORACLE count, browser isolation, migration 0021.
NOT VERIFIED: none of the above against a paid provider - by design.
PARTIAL: nothing claimed beyond what was executed.

## Remaining limitations

- A Gateway-token holder can send `0`; fail-safe covers omission, not a deliberate lie.
- Revocation cannot remove personal facts already stored in a conversation.
- A command submitted while the interface is THINKING is dropped rather than queued; the harness now
  waits, but a person will still see this.
- ORACLE historical rows are accurate history and are not rewritten.
