# INHERITANCE: SENTINEL — final report

Baseline `2a9a0c5` → this pass. `local-owner` untouched: no statement read, approved, granted,
revoked or exported. All fixtures synthetic, own principal `synthetic-sentinel-principal`.

## 1 · Composition proof — the missing link closed

`scripts/compiler-wire-proof.ts` now runs the chain SOVEREIGNTY identified as incomplete:

```
PostgreSQL (synthetic rows written through the real service)
  → PersonalMemoryStore.loadForSelection        REAL  → 3 records read back
  → selectMemories + composeMemoryContext       REAL  (adaptive budget)
  → ContextCompiler                             REAL  → ceiling from privacy_class column
  → CognitionOrchestrator → AgentRuntime        REAL
  → HttpModelGatewayClient → Gateway process    REAL
  → OpenAICompatibleAdapter                     REAL
  → loopback provider                           FIXTURE (only intended fiction)
```

Component matrix:

| Component | Status |
|---|---|
| PostgreSQL memory repository | **REAL** — rows written via `PersonalMemoryService`, read via `PersonalMemoryStore` |
| Memory selection + budget | **REAL** |
| `ContextCompiler` | **REAL** — constructed with its production dependencies; evidence reader served from persisted rows |
| Orchestrator, runtime, gateway client, gateway process, adapter | **REAL** |
| State/event slices fed to the compiler | **STUBBED** — empty Proxy; this fixture proves ceiling logic, not state assembly |
| Provider transport | **FIXTURE**, loopback |

**How the real compiler derives its ceiling:** `compile()` computes `maxPrivacyOf(result.kept)` over
the items it keeps, and throws `required evidence exceeds privacy ceiling` when a required item's
class is above `req.maxPrivacyClass`. The evidence items here are built from the `privacy_class`
column of the rows this script persisted — not from a value invented for the test.

**Nine checks, all passing** (`compiler-wire-proof.json`):

| # | Check | Result |
|---|---|---|
| 1 | repository returns 3 approved records from PostgreSQL | PASS |
| 2 | persisted classification survives the round trip | PASS |
| 3 | compiler derives INTERNAL from the eligible row | PASS |
| 4 | compiler refuses RESTRICTED evidence under an INTERNAL ceiling | PASS |
| 5 | compiler reports SENSITIVE when the ceiling allows it | PASS |
| 6 | eligible DB memory reaches the provider body | PASS |
| 7 | SENSITIVE memory never reaches the wire | PASS |
| 8 | a malicious instruction cannot raise the ceiling | PASS |
| 9 | the run port is served by the process this script spawned | PASS |

**Count reconciliation, as instructed:** 9 checks; 8 are distinct properties and 1 (#9) is a
process-identity assertion. Privacy conditions asserted across the check set: 6 (eligible-present,
sensitive-withheld, restricted-refused-at-compiler, ceiling-derived, escalation-ineffective,
local-turn-no-leak).

## 2 · Fail-closed provider redirect

`assertProviderBaseUrl` in `apps/gateway/src/runtime-config.ts`, applied only when
`JARVIS_ALLOW_PROVIDER_REDIRECT=1`:

- scheme must be plain `http:`;
- host must be a **numeric loopback** address (`127.x.x.x`, octets ≤ 255) — `localhost` is refused
  because it is a name, not an address;
- an explicit port is required;
- embedded credentials are refused, so `http://127.0.0.1@evil.example` cannot pass as loopback;
- `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY` (and lowercase) must be unset;
- the provider fetch is wrapped with `redirect: 'error'`, so a 3xx is a failure, not a hop.

With the flag off, none of this runs: production configuration is unchanged, and a test asserts it.

13 adversarial tests (`apps/gateway/src/provider-redirect.test.ts`) cover: valid loopback,
hostname, non-loopback IP, bad scheme, embedded credentials, the userinfo trick, missing port, both
proxy variables, production untouched, flag-is-not-truthy-string, redirect-turned-error, and
deterministic failure when the fixture is down. **No test contacts an external service** — the
rejections happen before a socket is opened.

## 3 · Stale-process protection

The gateway port is reserved per run (`listen(0)`, then closed), so no stale process can own the
port the run will use. The child is spawned by this script, its pid checked alive before use, and
the tree killed with `taskkill /T /F`. A regression test in `launcher-hygiene.test.ts` forbids a
fixed port constant in either harness.

Not implemented: a health-response nonce. The structural guarantee (unique port + own pid) is
stronger than a shared secret in a health body, and a nonce would only re-state it.

## 4 · Remaining limitations

1. **Concurrency:** revocation is re-read immediately before dispatch; the interval to the socket
   write is not atomic and is not claimed to be. Nothing is held across the provider call.
2. **Network isolation:** application-level URL validation only. No container/namespace isolation,
   no egress firewall. A root-level socket could still reach anywhere.
3. **Compiler state:** empty state slices mean the proof exercises ceiling derivation, not state
   assembly (which has its own suite).
4. **Retry path:** the client does not retry; the gateway may, without memory visibility.
5. **HUMANITY live acceptance:** not performed. Deterministic checks are not conversational quality.

## 5 · Reproduction

```powershell
cd D:\Projects\Jarvis-Sentience
$pnpm = "C:\Users\rhysl\AppData\Local\node\corepack\v1\pnpm\9.15.9\bin\pnpm.cjs"
$env:JARVIS_DB_URL = "<your value>"

node $pnpm exec tsx scripts/compiler-wire-proof.ts      # 9/9
node $pnpm exec tsx scripts/provider-wire-proof.ts      # 9/9 (8 cases + authority)
node $pnpm exec vitest run apps/gateway/src/provider-redirect.test.ts
node $pnpm exec vitest run                              # full suite
node $pnpm exec tsc -p tsconfig.json --noEmit
node $pnpm lint
node scripts/run-gate.mjs fitness
node $pnpm build:desktop
```

## 6 · Classification

| Requirement | Status |
|---|---|
| Real PostgreSQL repo + real ContextCompiler in one wire proof | **VERIFIED** |
| Ceilings derived from persisted classifications | **VERIFIED** |
| Escalation by instruction refused | **VERIFIED** |
| Fail-closed redirect validation | **VERIFIED** |
| Adversarial egress suite | **VERIFIED** (13 tests, no external contact) |
| Stale-process protection | **VERIFIED** (ephemeral port + pid + tree kill) |
| Network-level isolation | **NOT IMPLEMENTED** (documented) |
| Atomic revocation across the socket write | **NOT IMPLEMENTED** (documented, not claimed) |
| Owner-data isolation | **VERIFIED** — synthetic principal only |
