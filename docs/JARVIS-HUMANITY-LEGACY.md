# JARVIS · Humanity: Legacy

From `3c0a3ab`. Closes three of the six gaps; two remain, named at the bottom with the exact
blocker rather than a claim.

## 1 · Dispatch-boundary memory authority — DONE

`verifyBeforeDispatch` covered the conversation grant. It did not revalidate the *records* that
grant had admitted. Now `converseInner` re-reads memories from PostgreSQL and re-selects
immediately before `cognize`:

```
decide locality → build memoryCloud / memoryLocal → [compile] → RE-READ + RE-SELECT → dispatch
```

If a record was revoked, deleted, superseded, reclassified or reassigned to another principal
during compilation, it is not in the set that gets transmitted. The window is the time between
the re-read and the outbound call — milliseconds, single-process, and documented as such: this
is not a distributed transaction, and it cannot recall a request already sent.

Tested in the acceptance harness by revoking at the record level and re-selecting: the record
disappears from the local *and* cloud sets, and `deleteContent` removes it from both.

## 2 · Category-aware retrieval — DONE

`categoryHintFor(input)` maps broad requests onto the schema's own category names:

| request | categories considered |
|---|---|
| "Time for a hype session." | milestone, business, project, ambition, history, decision |
| "How far have we come?" | milestone, decision, project, business, history |
| "What should we work on tonight?" | project, decision, constraint, ambition |
| "What do you know about me?" | preference, communication, ambition, business, project, skill |
| greeting, music, banter | none — lexical only |

A category match scores 0.75, enough to be relevant without keyword overlap, and the six-record
budget still applies. A hint widens what may be *considered*; principal, approval, class and
disclosure checks are unchanged, so a SENSITIVE milestone is still excluded from a cloud hype
session (tested).

Proven with synthetic statements that contain none of the words "hype", "journey" or "session":
they are retrieved by category, and a greeting or "Girls on Film!" retrieves nothing.

## 3 · Explicit memory requests — DONE

`rememberRequest(input)` accepts only an imperative, and rejects negation, hypotheticals and
pretend:

| input | result |
|---|---|
| "Remember that I prefer detailed engineering reports when I ask for them." | candidate created from "I prefer detailed engineering reports when I ask for them." |
| "Don't remember that." | none |
| "Remember: imagine I preferred concise summaries." | none |
| "Pretend you remembered this." | none |
| "I prefer concise summaries." | none — ordinary chat is not a memory request |
| "Do you remember the Aurora codename?" | none |

The candidate is written by the store as `pending`, `SENSITIVE`, `cloudEligible: false`, with
`source: 'conversation-request'`. The model cannot approve it. If the write fails, the turn
still runs and nothing claims storage.

## 4 · What is NOT done — the honest two

**Outbound provider payload.** I did not produce a captured HTTP body. Doing it properly needs
one of: a Kernel whose cognition path points at a local fixture provider, or a fixture
transport injected into `CognitionOrchestrator` at the `runtime.invoke` boundary. That
orchestrator is constructed inside the Kernel lifecycle with the real gateway; wiring a
fixture into it is a change to production composition, not a test, and I would not do that
silently at the end of a session. What *is* proven: the two context strings, the revalidation
at dispatch, and the fact that a cloud turn can only ever receive `memoryCloud`.

**Concurrency guarantee.** Revalidation narrows the window; it does not close it. A revocation
that lands after the re-read but before the socket write is not prevented. Closing it means
holding the memory rows in the same transaction the dispatch key is issued under, which is a
larger change than this pass allowed.

## 5 · Import contract (exact, as implemented)

Validation lives in `validateImportRecord`; anything not listed is rejected with a reason and an
index. Import is all-or-nothing per record, never per file: bad records are reported, good ones
are staged.

**Top level** — `{ "schemaVersion": 1, "records": [ … ] }`. Other top-level keys are ignored.
`schemaVersion` absent is accepted; any value other than `1` throws.

| field | required | rule |
|---|---|---|
| `recordId` | no | string; generated if absent; duplicates are skipped |
| `category` | yes | one of the 13 below |
| `subject` | yes | 1–200 chars; one live statement per (principal, category, subject) |
| `statement` | yes | 1–2000 chars |
| `source` | no | string, default `import` |
| `sourceType` | no | string, provenance only |
| `confidence` | no | number 0–1, default 0.6 |
| `privacyClass` | no | `PUBLIC` \| `INTERNAL` \| `SENSITIVE` \| `RESTRICTED`, default `SENSITIVE` |
| `cloudEligible` | **ignored** | always stored `false` |
| `reviewStatus` | **ignored** | always stored `pending` |

**Categories:** `preference, communication, interest, skill, learning, family_priority,
ambition, business, project, history, decision, milestone, constraint`.

**Classifications:** `PUBLIC, INTERNAL, SENSITIVE, RESTRICTED`. Cloud ceiling is `INTERNAL`:
only `PUBLIC` and `INTERNAL` may ever be disclosed, and only with a per-record grant.

**Duplicates:** same `subject` (case-insensitive) and identical `statement` within the same
principal is skipped and counted. There is **no batch size limit** in code — practical limit is
statement length × records against memory; import 50–200 records at a time.

**Dates:** the schema stores `recorded_at` server-side; import does not accept a date field yet.
`effectiveAt` / `lastVerifiedAt` from the design are not implemented — say so rather than
inventing them.

Complete valid example: `docs/examples/personal-knowledge-pack.json` (8 records, passed through
the runtime validator).

## 6 · Operator runbook (PowerShell 5.1)

```powershell
cd D:\Projects\Jarvis-Sentience
$pnpm = "C:\Users\rhysl\AppData\Local\node\corepack\v1\pnpm\9.15.9\bin\pnpm.cjs"
$env:JARVIS_DB_URL = "postgres://jarvis:jarvis@127.0.0.1:5433/jarvis"
New-Item -ItemType Directory -Force -Path "D:\JarvisData\Memory\Imports" | Out-Null

# 1. stage the pack (never inside Git)
Copy-Item "$HOME\Downloads\personal-knowledge-pack.json" "D:\JarvisData\Memory\Imports\pack.json"

# 2. import — everything lands pending, nothing is usable yet
node $pnpm memory import "D:\JarvisData\Memory\Imports\pack.json"

# 3. review
node $pnpm memory list
node $pnpm memory show mem_synthetic_response_length

# 4. approve for local use only
node $pnpm memory approve mem_synthetic_response_length

# 5. optionally allow cloud disclosure for one record (INTERNAL/PUBLIC only)
node $pnpm memory grant-cloud mem_synthetic_response_length
node $pnpm memory revoke-cloud mem_synthetic_response_length

# 6. correct, revoke, delete, export
node $pnpm memory correct mem_synthetic_response_length "response-length-preference" "Prefers detailed reports when asked."
node $pnpm memory revoke  mem_synthetic_response_length
node $pnpm memory delete  mem_synthetic_response_length
node $pnpm memory export "D:\JarvisData\Memory\export.json"
```

Principal defaults to `local-owner`; set `$env:JARVIS_PRINCIPAL_ID` to use another (that is how
the acceptance harness isolates itself). No credential is written anywhere; the CLI uses the
same database URL the Kernel does.

## 7 · Classifications

| | |
|---|---|
| MEMORY_APPLICATION_SERVICE · PERSISTENCE · RESTART_CONTINUITY · IMPORT_SCHEMA · IMPORT_STAGING · OWNER_MANAGEMENT · CORRECTION · REVOCATION · DELETION | **VERIFIED_LIVE** |
| PRODUCTION_COGNITION_INTEGRATION | **IMPLEMENTED_TESTED** — retrieval and revalidation wired; no live turn observed |
| MEMORY_DISPATCH_AUTHORITY | **IMPLEMENTED_TESTED** — record re-read before dispatch; narrow window documented |
| HYPE_CONTEXT_RETRIEVAL | **IMPLEMENTED_TESTED** |
| EXPLICIT_MEMORY_REQUEST | **IMPLEMENTED_TESTED** — candidate path wired; conversation turn not observed |
| CLOUD_MEMORY_PRIVACY | **IMPLEMENTED_TESTED** |
| FIXTURE_PROVIDER_PAYLOAD | **NOT_ATTEMPTED** — needs a fixture transport injected into the orchestrator |
| FULL_WORKSPACE_VERIFICATION | see the commit; the figure that matters is the full run, not this subset |

## 8 · Restart

Kernel only, key-bearing shell, `scripts/jarvis-up.ps1 -Down` then start. Gateway unchanged.
Migration `0020` is already applied; no further migration exists.
