# INHERITANCE: SOVEREIGNTY — final report

Baseline `ed9c84d` → this pass. Owner principal `local-owner` untouched: no statement read, no
approval, no grant, no export. All fixtures synthetic.

## 1 · Evidence reconciliation (the previous campaign, audited)

The FINAL ASCENSION diagram began at `composeMemoryContext`, which is real selection but not the
whole story. Component-by-component, as actually exercised by `scripts/provider-wire-proof.ts`:

| Component | Status | Note |
|---|---|---|
| PostgreSQL memory repository | **NOT EXERCISED** in the wire proof | records were built in memory; the persistence path is proven separately by `memory-acceptance.ts` against real PostgreSQL |
| Memory selection (`selectMemories`) | **REAL** | same function production calls |
| `composeMemoryContext` + adaptive budget | **REAL** | now mode-aware |
| Policy evaluation (class, consent, ceiling) | **REAL** | inside the selector, plus `routingPolicy` in the orchestrator |
| `ContextCompiler` | **STUBBED** | returns a fixed `INTERNAL` ceiling; needs a DB-backed domain to be real |
| `CognitionOrchestrator` | **REAL** | routing, constraints, dispatch-time authorisation |
| `AgentRuntime` | **REAL** | manifests, budget clamp, correlation and proposal validation |
| `HttpModelGatewayClient` | **REAL** | real `fetch`, SSE parsing |
| Model Gateway process | **REAL** | child process, own port, real routes |
| `OpenAICompatibleAdapter` | **REAL** | the exact class used for OpenRouter |
| Mock provider transport | **MOCKED** | loopback HTTP; the only intended fiction |

**Scenario reconciliation.** The previous report said "9/9 scenarios". There are 8 memory cases
plus 1 authority-integrity assertion; several cases bundle multiple privacy conditions. Distinct
conditions asserted: **13** (present-when-eligible, no-consent, pending, SENSITIVE, RESTRICTED,
revoked, deleted, superseded, cross-principal, irrelevant, injection-as-data, authority-intact,
revoked-after-selection). The report should have said 8 cases / 13 conditions, not 9 scenarios.

**Egress analysis — what the redirect opt-in does and does not do.**

- The gateway refuses to start with `JARVIS_OPENROUTER_BASE_URL` set unless
  `JARVIS_ALLOW_PROVIDER_REDIRECT=1`. That is a guard against accident, not proof of isolation.
- The base URL is loopback in the proof (`http://127.0.0.1:<ephemeral>/v1`); the adapter's only
  outbound calls are `${base}/chat/completions`, `${base}/models` and `${base}/key`, all captured
  by the mock — verified by watching the mock's request log, which showed every probe.
- **Not prevented:** a redirect to a non-loopback host, an `HTTP(S)_PROXY` environment variable,
  or a redirect *response* (3xx) followed to another host. The mock never issues 3xx, but nothing
  in the code forbids it. Fixing that properly means validating the resolved host in the adapter
  and disabling redirect following — recommended, not implemented.
- No production credentials: the child process is given a literal `fixture-key`.
- No paid calls: the mock answers, and `NO_ROUTE` fires before any socket write if routing cannot
  reach a healthy fixture model.
- **Not implemented:** a startup assertion that the configured provider host is loopback when the
  redirect flag is on. Until that exists, isolation is a property of this script, not of the
  gateway.

**Discrepancy resolved:** an orphaned gateway from an interrupted run was found serving a stale
configuration on a fixed port. Cause: the script killed the pnpm wrapper and left the `tsx` child
listening, so the next run's `/health` was answered by the old process. Fixed by reserving an
ephemeral port per run and killing the child tree (`taskkill /T /F`), with a regression test
asserting no fixed port constant returns.

## 2 · Interactive memory review — implemented

`node $pnpm memory review` (also `pnpm memory review`). Local, interactive, resumable.

- Opening summary: principal, total, active, pending, and the explicit statement that local
  approval does **not** grant cloud consent.
- Per record: category, subject, statement, source, confidence, class, cloud status, status,
  progress.
- Actions: **A** approve locally · **S** skip (stays pending) · **Q** quit safely · **H** help.
- No bulk approval, no implicit approval, no approval on an empty line.
- **Resumability is the database**: each loop iteration re-reads pending records, so an
  interruption, a crash or a second process cannot desynchronise a counter. There is no counter.
- An approval is reported only after re-reading the record and seeing `approved`; a failure, or a
  write that did not persist, is reported as an error instead of a success.
- Refuses to run without a TTY, so a pipe can never approve silently.

Recovery cases covered by `memory-review.test.ts` (13 tests): explicit approval only, empty input,
skip, quit, closed stdin, failed write, unpersisted write, lost acknowledgement, resume from
database state, empty queue, principal scoping, and no statements in the summary.

## 3 · Launcher / orphan hardening

- Ephemeral gateway port per proof run; child tree terminated with `taskkill /T /F`.
- `jarvis-up.ps1` already refuses to start over an owned port and terminates children first;
  unchanged.
- Regression test asserts the wire proof has no fixed port constant and does kill the tree.

Not done: process-identity verification (command line contains this repo) in the proof harness.
The launcher has it; the harness relies on its own pid tree instead.

## 4 · Revocation boundary

| moment | behaviour |
|---|---|
| before selection | record never considered |
| after selection, before dispatch | re-read removes it (proven) |
| during transmission | **not prevented**; interval = final re-read → socket write |
| after transmission | cannot be recalled |
| retry | not applicable — the client does not retry; the gateway does, and has no memory visibility |

No transaction is held across the provider request. See `docs/ADR-inheritance-disclosure-boundary.md`.

## 5 · Verification

| Check | Result |
|---|---|
| Full suite (`vitest run`) | **824 passed · 4 skipped · 0 failed · 138 files** |
| Typecheck | clean |
| Lint | clean |
| Fitness | 17/17 |
| Production build | compiled (pre-existing `import.meta` warning via kokoro) |
| Provider wire proof | 8 cases / 13 conditions, all pass |
| Memory acceptance (real PostgreSQL, two processes) | 17/17 |

## 6 · Owner commands

```powershell
cd D:\Projects\Jarvis-Sentience
$pnpm = "C:\Users\rhysl\AppData\Local\node\corepack\v1\pnpm\9.15.9\bin\pnpm.cjs"
$env:JARVIS_DB_URL = "<your existing value>"

node $pnpm memory list            # totals + pending
node $pnpm memory review          # interactive: A / S / Q / H  (resume by re-running)
node $pnpm memory show <id>
node $pnpm memory grant-cloud <id>    # separate, explicit, per record
node $pnpm memory revoke-cloud <id>
node $pnpm memory correct <id> "subject" "statement"
node $pnpm memory revoke <id>
node $pnpm memory delete <id>
```

## 7 · Remaining limitations (stated, not hidden)

1. `ContextCompiler` is still stubbed in the wire proof — needs a DB-backed domain fixture.
2. Provider redirect following and proxy routing are not constrained in code.
3. No retry-path memory revalidation.
4. HUMANITY live acceptance not performed; deterministic context tests only.
5. Resumable *cloud-consent* review not implemented as a separate command.
