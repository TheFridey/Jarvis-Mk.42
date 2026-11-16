# JARVIS · Synapse

Baseline `9337213` → this pass. Mark 42 untouched at `9c1b880`, V2 untouched. No push,
no merge, no paid inference, no credential read, no microphone.

The durable, explicitly-permissioned cloud conversation path now exists: schema, policy,
grant lifecycle, provider binding, Kernel enforcement, and a presence control. What has
not happened is a paid request — that still waits for your authorisation.

## Classifications

| Workstream | Result | Basis |
|---|---|---|
| PRIVATE_CONVERSATIONS | **VERIFIED_LIVE** | Existing behaviour preserved; live DB shows 39 turns, 0 classified, 39 private after migration. |
| CLOUD_CONVERSATION_GRANTS | **IMPLEMENTED_TESTED** | Table + Kernel commands + HTTP routes + UI control; 22 policy tests. No live grant exercised. |
| DURABLE_PRIVACY_CLASSIFICATION | **IMPLEMENTED_TESTED** | `privacy_class`/`privacy_regime` written per turn; migration verified on a disposable database. |
| CLOUD_CONTEXT_FILTERING | **IMPLEMENTED_TESTED** | Only turns written under the grant, within the ceiling, are compiled; everything else refuses. |
| PROVIDER_BINDING | **IMPLEMENTED_TESTED** | `requiredProvider` is a hard registry filter with `NO_ROUTE` on failure; 6 registry tests. |
| GRANT_REVOCATION | **IMPLEMENTED_TESTED** | Revocation is a row update; the next dispatch re-reads it. Cannot recall what was sent — documented. |
| RESTART_PERSISTENCE | **IMPLEMENTED_TESTED** | Grants and revocations live in Postgres, not memory. Not exercised across a restart with a real request. |
| FIRST_TURN_INFERENCE | **BLOCKED_EXTERNAL** | No key, no authorisation. |
| MULTI_TURN_CLOUD_INFERENCE | **BLOCKED_EXTERNAL** | Same, plus unexercised end to end. |
| INFERENCE_RESOURCE_CONTROLS | **IMPLEMENTED_TESTED** | Ceiling, clamp, timeout, cost, no silent fallback (5 + 6 tests). |
| EVENT_TOPOLOGY_INTEGRITY | **PARTIAL** | Root cause of the 32 unowned events identified; a guard was not added. |
| DEAD_LETTER_LIFECYCLE | **PARTIAL** | Backlog visible and honest; no resolution column or replay. |
| RTC_CONFIGURATION | **BLOCKED_EXTERNAL** | No `livekit.yaml`; generator deliberately not invented. |
| PHYSICAL_VOICE | **NOT_ATTEMPTED** | Needs your gesture. |
| LOCAL_MODEL_READINESS | **BLOCKED_EXTERNAL** | No model, 1.5 GB free RAM. |
| DOCKER_STORAGE | **VERIFIED_ON_D** | 121 GB under `D:\Docker\wsl`; volumes are Docker-managed named volumes. |
| MODEL_STORAGE | **PARTIAL** | Convention documented (`D:\AI\Models`); nothing downloaded or moved. |
| JARVIS_RUNTIME_STORAGE | **PARTIAL** | Source and `.logs` already on D:; no configurable path added. |
| WSL_MEMORY_AND_SWAP | **PARTIAL** | No `.wslconfig` exists (defaults); swap state not observable without guessing. |
| DATABASE_RELIABILITY | **PARTIAL** | Reassessed: memory pressure is the better hypothesis than C: space; not proven. |
| EVIDENCE_HYGIENE | **PARTIAL** | Text clean; one image known-replaced; remaining images unverified. |
| OPERATOR_STARTUP | **VERIFIED_LIVE** | Unchanged and still correct; new capability documented around it. |

## A — What was implemented

### Schema (migration `0019`, additive)

- `experience.conversation_turns.privacy_class` — nullable, `PUBLIC|INTERNAL|SENSITIVE|RESTRICTED`.
- `experience.conversation_turns.privacy_regime` — `NOT NULL DEFAULT 'PRIVATE'`.
- `experience.conversation_grants` — `grant_id, conversation_id, principal_id, provider,
  model, purpose, ceiling, policy_version, created_at, expires_at, revoked_at, revoked_by`,
  with a **partial unique index** so a conversation can only ever have one live grant.

Verified on a disposable database (`jarvis_migration_test`) before applying to the dev
database. After applying: **39 turns, 0 classified, 39 private** — existing history is
unchanged and permanently ineligible for cloud, exactly as required. No backfill, no
invented classifications, nothing deleted.

### Policy (`apps/core/src/kernel/experience/conversation-privacy.ts`, pure)

`evaluateConversationGrant` refuses on: no grant, unknown conversation, conversation
mismatch, cross-principal, revoked, expired (including unreadable expiry), policy-version
mismatch, provider mismatch, purpose not permitted, ceiling above cloud, unclassified
history, ceiling exceeded, malformed grant. Twelve refusal reasons, each testable.

Two decisions worth stating:

1. **A grant is not a key to history.** Only turns created *after* the grant are eligible.
   Older turns were private when written; a later authorisation cannot retroactively
   release them. They are dropped from outbound context, not silently included.
2. **Unclassified means RESTRICTED.** `classificationForTurn(undefined)` returns
   `RESTRICTED`, so a turn from before this schema can never become cloud-eligible, and a
   future code path that forgets to classify fails closed.

`CLOUD_CEILING = 'INTERNAL'`. A grant cannot declare SENSITIVE or RESTRICTED — such a
grant is refused at creation *and* at dispatch, because the existing routing rule forces
local for those classes regardless.

### Enforcement (`companion-service`)

For a turn on an existing conversation the Kernel now:

1. loads every completed turn of that conversation with its class and regime;
2. loads the live grant;
3. evaluates the policy;
4. if allowed — routes with `locality: 'cloud-ok'`, `cloudAllowed: true`,
   `requiredProvider: <grant.provider>`, `preferredModels: [<grant.model>]`,
   `contextCeiling: <grant.ceiling>`, and compiles history from the eligible turns only;
5. if refused — keeps the existing forced-local behaviour (unchanged), so a private
   conversation behaves exactly as before;
6. writes `privacy_class` (from the classification the request actually ran under) and
   `privacy_regime` on completion.

A **new** conversation may be started by an id that already has a live grant; without a
grant, an unknown id is still rejected as "conversation not found".

### Provider binding (`model.ts`, `registry.ts`)

`preferredProviders` was only a score preference — it could not prevent substitution.
`requiredProvider` is now a hard filter in `ModelRegistry.rejection`, and `route()` throws
`NO_ROUTE` when the bound provider has no eligible model. No fallback, by construction.
Tests cover: bound provider serves, unknown provider refuses, unhealthy provider refuses
rather than substituting, unbound routing unchanged, SENSITIVE context still forced local.

### Operator surface

- `POST /desktop/conversations/grant` — `{conversationId, provider, model, ceiling?, expiresInMs?}`
- `POST /desktop/conversations/revoke` — `{conversationId}`
- `POST /desktop/conversations/privacy` — current regime, grant, and refusal reason
- Presence Mode shows one chip: `PRIVATE · THIS MACHINE` or `CLOUD · <provider>`, with an
  affirmative `ALLOW CLOUD` / `MAKE PRIVATE` action. No opt-out default, no automatic
  cloud selection when local inference is missing, no settings panel.

Grant creation requires the active principal and a `desktop.write` session on a
`kernel-local`/`owned-secure` node. The UI never decides; it asks, and renders the answer.

## B — Privacy decisions (deltas from ADR-003)

ADR-003 proposed a mode column; the implementation instead keeps the regime on the turn
and the authority in a separate grants table. That is stronger: the regime is a *fact
about how a turn was produced*, and the grant is a *revocable authority*, so revoking a
grant cannot rewrite history and changing a mode cannot silently reclassify old turns.
ADR-003 has been updated to match.

HYBRID is not implemented. The classification needed to make it meaningful exists, but a
per-fragment hybrid split would need a second dispatch path and its own tests; shipping a
half-hybrid was explicitly out of bounds.

## C — Adversarial verification

22 policy tests (all scenarios from the brief that are expressible without a database),
6 registry tests, 5 output-budget tests, 4 rendered-component tests. Selected results:

| Requirement | Test | Result |
|---|---|---|
| New conversations default private | `no grant → no_grant` | pass |
| Existing unclassified history never reaches cloud | `privacy_class null → unclassified_history` | pass |
| SENSITIVE/RESTRICTED cannot bypass | `→ ceiling_exceeded` / `ceiling_above_cloud` | pass |
| Unknown classification fails closed | `classificationForTurn(undefined) === 'RESTRICTED'` | pass |
| Provider substitution | `requiredProvider: 'anthropic'` → refused | pass |
| Cross-principal | grant and history both checked | pass |
| Revoked / expired / unknown policy version | each refused | pass |
| Private history not released by preference | pre-grant turns excluded from context | pass |
| Conversation id cannot bypass policy | mismatched id → `conversation_mismatch` | pass |
| Concurrent revocation and dispatch | revocation is read per dispatch; no cached decision | pass* |
| Model output cannot authorise itself | grants only via `desktop.write` command | pass* |

\* verified by construction and code inspection, not by a concurrency test — there is no
in-flight cancellation for a request already transmitted, and none is claimed.

**What revocation cannot do:** recall data already sent to a provider. Revocation affects
the next dispatch only. That is documented in the ADR and in the UI copy's intent.

## D — Verification results

| Command | Result |
|---|---|
| `tsc -p tsconfig.json --noEmit` | pass |
| `vitest run apps/desktop/src apps/core/src apps/gateway/src` | **545 pass** |
| `pnpm lint` | clean |
| `node scripts/run-gate.mjs fitness` | 17/17 |
| migration on disposable DB | applied 0019, schema verified |
| migration on dev DB | applied 0019, 39 turns untouched |
| `pnpm build:desktop` | pass |

Not run: the Docker-dependent integration suites (they expect the full stack including a
model gateway). No destructive test touched the live database.

## E — Storage, memory, Docker (summary; detail in `JARVIS-STORAGE-RELOCATION.md`)

- **C: 6.3 GB free of 216 GB (98 %)**, **D: 660 GB free of 932 GB**.
- RAM 15,974 MB total, **1,575 MB available** at measurement; pagefile max 29,056 MB.
- Docker: `DockerRootDir=/var/lib/docker` (overlayfs), **121 GB under `D:\Docker\wsl`** →
  `DOCKER_STORAGE: VERIFIED_ON_D`. Postgres data is the named volume `jarvis-mk43_pgdata`
  inside that disk. Nothing relocated.
- No `.wslconfig` exists on this machine, so WSL is running defaults; whether swap is
  active is **not** observable through the checks available without changing state, and is
  reported as unknown rather than guessed.

## F — Event topology and dead letters

- 1041 dead letters, all `outbox-relay`, 2026-09-08 → 2026-10-08: `bus unhealthy` 1008,
  `canonical event has no JetStream owner` 32, one `CONNECT_TIMEOUT localhost:5433`.
- The 32 unowned events are the only *structural* defect: a canonical event type was
  published with no JetStream stream claiming its subject. Nothing was reassigned, replayed
  or deleted.
- `/diagnostics.events` now reports lifetime, since-start and unresolved counts separately.
- **Next slice (not implemented):** a startup topology check that fails loudly when a
  configured canonical event type has no owner, plus `resolved_at`/`resolution_code` on
  `events.dead_letter` to support the OPEN → INVESTIGATING → RETRY_ELIGIBLE → SUPERSEDED →
  RESOLVED lifecycle. Both need approval because they touch durable event data.

## G — RTC

`infrastructure/docker/rtc.compose.yml` mounts `artifacts/local-runtime/pki/livekit.yaml`,
which does not exist and is not generated by any script in the repository. LiveKit itself
runs (v1.9.12, loopback) and previously served real rooms, so the missing piece is
configuration, not capability. I did not invent a generator: a credential generator is a
security-sensitive addition and the mission allows it only "if justified". The exact
operator steps are in §I.

## H — Exact operator commands

```powershell
cd D:\Projects\Jarvis-Sentience

# 1. Start everything (no key yet = private conversations only, which is correct today)
powershell -ExecutionPolicy Bypass -File scripts\jarvis-up.ps1

# 2. Enable cloud inference for this shell only, when you are ready to spend
$secure = Read-Host -AsSecureString "OpenRouter runtime key (JARVIS-RUNTIME, $1 limit)"
$env:OPENROUTER_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
$env:JARVIS_OPENROUTER_MODEL = 'deepseek/deepseek-v4.1-flash-1017'
$env:JARVIS_PREFERRED_MODELS = $env:JARVIS_OPENROUTER_MODEL
powershell -ExecutionPolicy Bypass -File scripts\jarvis-up.ps1 -Build

# 3. Authorise one conversation (the presence chip does this; here it is explicitly)
$body = @{ commandId=[guid]::NewGuid().ToString(); expectedStateVersion=0;
           conversationId='synapse-test-1'; provider='openrouter';
           model='deepseek/deepseek-v4.1-flash-1017'; ceiling='INTERNAL' } | ConvertTo-Json
# expectedStateVersion must match GET /desktop/snapshot's stateVersion.
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:7420/desktop/conversations/grant `
  -Headers @{ Authorization = "Bearer $env:JARVIS_SESSION" } -Body $body -ContentType 'application/json'
```

The chip is the intended path: press **ALLOW CLOUD**, confirm, then type. Revoke with
**MAKE PRIVATE**; the next request is refused cloud immediately.

## I — Blockers and approvals

**Blocked externally**

1. OpenRouter runtime key — needed for any real inference. No request is made without it.
2. A local model — needed for private multi-turn continuity (and for any RESTRICTED context).
3. `artifacts/local-runtime/pki/livekit.yaml` — needed for voice.

**Approvals needed before proceeding**

1. Authorise the bounded paid test (§J) — one conversation, four short turns, ~$0.01 at
   this model's pricing, capped by the key's own $1 limit.
2. Approve creating `livekit.yaml` (new local file, generated with `crypto.randomBytes`,
   0600, outside git) if you want the generator rather than supplying your own.
3. Approve freeing space on C: or relocating any remaining large cache — nothing was moved.
4. Approve the dead-letter schema slice in §F if you want incident lifecycle rather than
   visibility.

## J — Bounded live test (prepared, not executed)

| Turn | Input |
|---|---|
| 1 | "Hello Jarvis. Introduce yourself in one sentence." |
| 2 | "For this synthetic test, the fictional project codename is Aurora." |
| 3 | "What was the fictional project codename?" |
| 4 | "Summarise this conversation in one sentence." |

Expected: turn 1 succeeds on the grant; turns 2–4 are cloud-routed **only** because the
grant exists and every turn inherits `INTERNAL` with the `CLOUD_PERMITTED` regime. Verify:

```sql
select turn_id, conversation_id, status, privacy_class, privacy_regime, left(answer,60)
from experience.conversation_turns where conversation_id='synapse-test-1' order by created_at;
select grant_id, provider, model, ceiling, revoked_at from experience.conversation_grants;
select request_id, model_id, privacy_class, usage_observability->>'costEstimate'
from cognition.runs order by started_at desc limit 4;
```

Then: restart the Kernel, repeat turn 3 in the same conversation (grant must survive);
revoke, and confirm the next turn is refused cloud and either runs locally or fails with
the privacy/locality error — never silently sending to a provider.

## K — Next milestone

1. Execute §J under your authorisation and record real usage numbers.
2. Local model on `D:\AI\Models` for private continuity (needs ~8 GB free RAM first).
3. LiveKit configuration generator + voice qualification.
4. Dead-letter resolution lifecycle + startup topology guard.
5. Optional: cap conversation spend per grant (`maxCostUSD`) once real cost data exists.
