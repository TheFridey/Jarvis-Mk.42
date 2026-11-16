# JARVIS · Humanity: Continuum

From `45de6f4`. The connectors are closed, using synthetic records and an isolated principal —
no real personal data was needed and none was requested.

## What runs now

```
import (JSON) ──► pending ──► approve ──► PostgreSQL ──► new process ──► retrieval
                    │                                         │
                    └── invisible until approved              └── filtered by locality, principal, relevance
```

**Acceptance, two separate processes** (`docs/evidence/humanity-continuum/acceptance.txt`):

```
phase1: 5/5 passed     import → pending → not retrievable → approve → persisted
phase2: 12/12 passed   survived new process → retrieved → greeting retrieves nothing
                       → excluded from cloud → grant → included → revoke → excluded
                       → cross-principal empty → correction supersedes → hostile import inert
                       → deletion removes statement, keeps audit fact
```

Phase 1 exits the process. Phase 2 is a genuinely new one reading PostgreSQL — that is the
restart-continuity claim, not a value held in memory.

## Production integration

`companion-service.converseInner` now loads approved memory for the principal and builds **two**
context strings before dispatch:

- `memoryLocal` — everything approved, including SENSITIVE and RESTRICTED;
- `memoryCloud` — only records that are `cloudEligible` **and** at or below `INTERNAL`.

The turn uses `decision?.allow ? input + memoryCloud : input + memoryLocal`, so the privacy
decision made by the grant machinery also decides which memory text may exist. A revocation
between decision and dispatch is still covered by the existing `verifyBeforeDispatch`.

Relevance decides inclusion: "Evening Jarvis." retrieves nothing, "How detailed should your
technical answers be?" retrieves the preference. Maximum six records, subject-weighted lexical
scoring, query-normalised so a long record cannot outrank a precise one.

## Import schema

`schemaVersion: 1`, records as an array. Fields map onto the implemented table — no parallel
representation:

| field | required | notes |
|---|---|---|
| `recordId` | no | generated if absent |
| `category` | yes | one of `preference, communication, interest, skill, learning, family_priority, ambition, business, project, history, decision, milestone, constraint` |
| `subject` | yes | ≤ 200 chars; one live statement per subject |
| `statement` | yes | ≤ 2000 chars |
| `source`, `sourceType` | no | provenance, stored verbatim |
| `confidence` | no | 0–1, default 0.6 |
| `privacyClass` | no | `PUBLIC \| INTERNAL \| SENSITIVE \| RESTRICTED`, default `SENSITIVE` |
| `cloudEligible` | **ignored** | always imported `false` |
| `reviewStatus` | **ignored** | always imported `pending` |

A file cannot approve itself or grant cloud disclosure. Imported text is data: an instruction
inside a statement is stored as text and never executed — the acceptance run imports exactly
such a record and asserts it stays pending and inert.

Example: `docs/evidence/humanity-continuum/import-example.json`.

## Operator commands (PowerShell 5.1)

```powershell
cd D:\Projects\Jarvis-Sentience
$pnpm = "C:\Users\rhysl\AppData\Local\node\corepack\v1\pnpm\9.15.9\bin\pnpm.cjs"
$env:JARVIS_DB_URL = "postgres://jarvis:jarvis@127.0.0.1:5433/jarvis"

node $pnpm memory list
node $pnpm memory import "D:\JarvisData\Memory\Imports\pack.json"
node $pnpm memory show  mem_abc123
node $pnpm memory approve mem_abc123
node $pnpm memory reject  mem_abc123
node $pnpm memory grant-cloud  mem_abc123
node $pnpm memory revoke-cloud mem_abc123
node $pnpm memory correct mem_abc123 "response-length-preference" "Prefers detailed engineering reports when requested."
node $pnpm memory revoke mem_abc123
node $pnpm memory delete mem_abc123
node $pnpm memory export "D:\JarvisData\Memory\export.json"
```

Staging directory for packs: `D:\JarvisData\Memory\Imports`. Nothing private goes into Git.

## Revocation vs deletion — the distinction, precisely

| operation | statement kept? | usable? | cloud? | audit |
|---|---|---|---|---|
| `revoke-cloud` | yes | yes, locally | no | row unchanged |
| `revoke` | **yes** | no | no | `revoked_at` + reason |
| `delete` | **no** — replaced with `[deleted by owner]` | no | no | row survives as the fact of deletion |
| `correct` | old statement kept, `superseded_by` set | old no, new yes | inherits, granted separately | both rows live in history |

Deletion does **not** recall anything already transmitted to a provider. It removes the
content from the database, from selection and from every future context. There are no caches
or secondary indexes to purge: selection reads the table directly.

## Classifications

| | |
|---|---|
| MEMORY_APPLICATION_SERVICE | **VERIFIED_LIVE** |
| MEMORY_PERSISTENCE | **VERIFIED_LIVE** — PostgreSQL, separate process |
| MEMORY_RESTART_CONTINUITY | **VERIFIED_LIVE** |
| PRODUCTION_COGNITION_INTEGRATION | **IMPLEMENTED_TESTED** — wired into `converseInner`; the running Kernel has not yet served a turn with memory attached |
| CLOUD_MEMORY_PRIVACY | **IMPLEMENTED_TESTED** — enforced in selection and in the locality branch; not yet observed in a captured outbound body |
| FIXTURE_PROVIDER_PAYLOAD | **PARTIAL** — no fixture-provider capture of a memory-bearing request was produced; the two context strings are asserted at the boundary instead |
| IMPORT_SCHEMA / IMPORT_STAGING | **VERIFIED_LIVE** |
| OWNER_MANAGEMENT | **VERIFIED_LIVE** (CLI; no graphical surface) |
| MEMORY_CORRECTION / REVOCATION / DELETION | **VERIFIED_LIVE** |
| EXPLICIT_MEMORY_REQUEST | **PARTIAL** — `proposeFromConversation` exists and never approves; no conversation path calls it yet |
| HYPE_CONTEXT_RETRIEVAL | **NOT_ATTEMPTED** — category-aware retrieval for a hype session is not implemented; a narrow query still only matches literal words |
| FULL_WORKSPACE_VERIFICATION | **PARTIAL** — 163 tests in core experience + cognition, lint and typecheck clean; full-suite and build figures in the commit |

The honest gap is the last mile I could not close in this pass: the fixture-provider body. The
privacy decision is enforced one line above dispatch, and the acceptance proves selection, but
"the outbound HTTP body contained/omitted X" needs the fixture provider wired into a turn,
which needs a Kernel instance whose cognition path I can point at a fixture without your key.
