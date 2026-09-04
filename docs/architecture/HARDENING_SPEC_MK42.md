# MK.42 Hardening Specification — ASCENSION Stage B (for Codex GPT-5.6 SOL)

**Read first, in full:** `AUDIT_MK42_ASCENSION.md`, then ADR-0031 through
ADR-0038, then re-read `AGENCY_MODEL.md`, `SECURITY_MODEL.md`,
`FAILURE_MODEL.md`, `docs/security/threat-model.md`, `KERNEL_CONSTITUTION.md`.
Do not start a task until you have read the ADR it implements.

**Objective, in priority order:** reliability, resilience, security,
observability, performance, recovery, architectural fitness, distributed
readiness. **Not** feature expansion. Do not add capability adapters, agents,
model providers, or Experience features. If a task cannot be done without
weakening a documented boundary, stop and write an ADR proposal — do not
bypass.

**Global constraints (every task inherits):**

- No effect exists outside the real, wired Executor pipeline: Validator →
  Policy → Permission → freshness barrier (one tx) → simulate(≥HIGH, gated) →
  execute (out-of-process worker) → Executor-run verify → emit. No stage
  skippable, in any mode.
- The Policy Engine stays a pure function of typed inputs (`context.now`
  injected; no wall-clock, no network, no model; `llmRecommendation` ⇒ DENY
  only).
- Fail closed everywhere: unreachable approver, missing scope, stale grant,
  unknown capability, missing credential material, unconfigured policy for
  `riskClass ≥ MEDIUM`, un-runnable verification ⇒ the action does not
  complete.
- Every pipeline transition emits a real `EventManager` envelope (`AUDIT`, or
  `SECURITY` for denials/aborts/verification-failures/credential-mints/GUARDIAN).
- Telemetry and Sentinel are on **no** critical path; their failure never
  changes behaviour.
- Toolchain per `MK43_IMPLEMENTATION_NOTES.md` §2, **except** the OpenTelemetry
  SDK is now restored for `apps/core`/`apps/adapter-host`/`apps/labs`
  (ADR-0036). Relative imports carry `.ts`; vitest; unit `*.test.ts`
  co-located; integration `*.integration.test.ts` gated; new `*.fitness.test.ts`
  and `*.contract.test.ts` suites.
- Every task ends in an independently testable deliverable and moves at least
  one `AUDIT_MK42_ASCENSION.md` finding and/or one `threat-model.md` row to
  `Enforcement: enforced` (or `partial` with the remaining gap named).

Work the task groups roughly in order; H1–H5 are the critical path (they make
the security architecture real), H6–H8 make it observable and distributed,
H9–H12 make it resilient and provable, H13 is the proof.

---

## H1 — Wire the Agency Plane into the running Kernel (ADR-0031)

**Deliverable:** `pnpm core:dev` starts a Kernel that constructs and starts the
Capability Registry, Policy Engine (+ base rule pack), Permission Engine,
Capability Executor, Credential Broker, Adapter Host client, Sentinel detector
service, and the Guardian playbook; a synthetic proposal ingress accepts a
typed `CapabilityInvocationProposal`; one integration test drives a real
`filesystem` write end to end.

1. **Synthetic proposal ingress** (`apps/core/src/kernel/agency-ingress/`): one
   authenticated internal entry point. Accepts a typed
   `CapabilityInvocationProposal`, runs the real Validator (schema +
   evidence-trust ⇒ `derivedFromUntrusted`), hands to the Executor. No NL, no
   model. This is the seam for the future Cognition Orchestrator — document it
   as such.
2. **Leased actor minter** (`apps/core/src/kernel/agency-ingress/actor.ts`):
   the only constructor of an `EventActor{kind:'agent'}`; stamps `onBehalfOf`
   from a lease row, never from caller input (closes F-AG-11). Until an Agent
   Runtime exists, leases a single fixed internal actor.
3. **Kernel wiring** in `lifecycle/kernel.ts`: construct all agency components
   with PG-backed stores (H3), broker material from the secrets file (H5),
   base rule pack loaded into `agency.policy_rules`, Adapter Host client
   (out-of-process). Health-register each. Sentinel subscribed to the
   `SECURE`/`OPERATIONS` streams.
4. **Guardian wiring**: `runGuardianPlaybook` is invoked by the `ModeManager`
   on the deterministic transition into `GUARDIAN`; its steps run through the
   real Executor; add the missing restrict-only capability manifests
   (`capabilities.permission` tighten_all, `capabilities.agency_control`
   suspend_autonomous_external, `capabilities.audit` snapshot,
   `capabilities.node` isolate, `capabilities.notify` operator) — restrict/
   preserve only, no offensive verb, `verify` present.
5. **Fix C8**: `kernel.ts` `guardInputs.activeObjectiveCount` reads a real
   count (0 is acceptable only until the Objective Engine exists — wire it to a
   `state.getSlice('active_objective')` presence check now).
6. **Documentation honesty**: add `Status:` lines to every `*_MODEL.md` and
   design spec; add the `Enforcement` column to `threat-model.md`; reconcile
   the HEPHAESTUS design-spec component map with the tree (F-PROC-3). Mark
   `apps/desktop` experience `Status: prototype`.

**Tests:** an `agency.integration.test.ts` (Docker-gated) that boots the
Kernel, submits a `filesystem` `write_file` proposal for a path inside a
workspace grant, and asserts: policy ALLOW, out-of-process worker ran,
Executor-run verify confirmed the file, `jarvis.agency.invocation.verified`
event with a full envelope, `agency.invocations` row `COMPLETED`. A second test
submits a write **outside** the workspace and asserts `DENIED` + `SECURITY`
event.

---

## H2 — Executor-run verification & simulation gate (ADR-0032)

**Deliverable:** verification verdicts come from an Executor-owned
`VerificationRunner` interpreting the manifest strategy via a separate
read-only worker; simulation produces a persisted `PredictedEffect` that gates
approval; rollback is re-verified.

1. Rewrite `executor/verify-runner.ts` → `VerificationRunner` that interprets
   `world-read` / `state-echo` / `health-probe` / `hash-match` (separate
   read-only `adapterRef` action, fresh worker, `dry-run` credential) and
   `event-await` (ledger subscription). Demote `adapter.verify` to an optional
   self-check recorded as `execute_result_debug` only.
2. Registration (`manifest-validate.ts`): reject a `verificationStrategy`
   whose `adapterRef` action is not `AMBIENT`/`LOW`.
3. Pre-execution state capture: `beforeStateRef` via a read-only action for any
   `reversible` or `world-read` action, before `EXECUTING`.
4. Simulation: persist `PredictedEffect` to
   `agency.invocations.predicted_effect_ref`, emit on
   `.simulated`, attach to the `ApprovalRequest` (H4). `simulatable:false` at
   `≥HIGH` ⇒ escalate one authority tier, never fabricate a `PredictedEffect`.
5. Rollback: after `adapter.rollback`, re-run the verification strategy against
   `beforeStateRef`; `undone:false` or residual ⇒ `VERIFICATION_FAILED` +
   `security.alert.critical` + GUARDIAN recommendation. Wire `saga.ts`
   `compensateSteps` for `steps[]` with per-step verify.

**Tests:** executor unit tests with a fake adapter whose `execute` succeeds but
whose real-world effect is absent ⇒ `VERIFICATION_FAILED` (not `COMPLETED`); a
fake adapter that lies in `adapter.verify` ⇒ still `VERIFICATION_FAILED`; a
`≥HIGH` action ⇒ `PredictedEffect` persisted and approval carries it; a
reversible action failing verify ⇒ rollback runs **and** is re-verified.
Moves T26, T27 to `enforced`.

---

## H3 — Durable invocation lifecycle, real lease, saga recovery, idempotency (ADR-0033)

**Deliverable:** `agency.*` tables are the source of truth; a Kernel restart
mid-invocation compensates; a retried proposal is a no-op; the freshness
barrier is one transaction.

1. Replace `InvocationStore` (Map) with a PG-backed store + a single
   `invocation-projector.ts` folding `jarvis.agency.invocation.*` into
   `agency.invocations` / `agency.invocation_steps`. Executor emits via the
   real `EventManager`; `EventManager` rejects `jarvis.agency.invocation.*`
   from a non-Executor `source.component` (T21 enforcement site).
2. Replace `MemoryGrantStore` and `ResourceLeaseManager` with PG-backed
   implementations. Lease is an `agency.resource_leases` row keyed by
   `applySelector(manifest.resourceKeySelector, input)` (never
   `JSON.stringify(input)`); coarse fallback `capabilityId:action`.
3. One transaction for the freshness barrier: `SELECT ... FOR SHARE` on the
   grant + `INSERT ... ON CONFLICT` the lease `FOR UPDATE` +
   `jarvis.agency.invocation.started` append + `EXECUTING` row write. Mint
   happens after this commits.
4. Idempotency: `proposalId` on the proposal; `agency.proposal_dedupe` table;
   repeat ⇒ return existing invocation state, never re-execute. Canonical
   (sorted-key) serialization for `input_hash` in `executor.ts` **and**
   `state-manager.ts` (fixes F-DATA-4).
5. Cold-start recovery in `lifecycle/kernel.ts` after projections rebuild:
   scan non-terminal `EXECUTING`/`SIMULATING`/`ROLLING_BACK`/`COMPENSATING`
   rows, compensate/rollback (verified), emit terminal events, release orphan
   leases. Lease + handle TTL = `max(action.timeoutMs, minLeaseMs)` (fixes C5).
6. New migration `0009_agency_durability.sql` (the `0007` gap in the sequence
   is intentional and the runner is gap-tolerant — do not renumber).

**Tests:** integration test that kills the Kernel process between `EXECUTING`
and `VERIFYING` for a reversible action, restarts, and asserts compensation
ran and the row is terminal; a concurrency test that fires two proposals for
the same `resourceKey` and asserts one waits/rejects; a retried `proposalId`
test asserting a single execution. Moves T28 to `enforced`.

---

## H4 — Approval & dual-control enforcement (ADR-0034)

**Deliverable:** `REQUIRE_APPROVAL` never auto-approves; a real
`agency.approvals` row + Notification surface; timeout/unreachable ⇒ DENIED;
CRITICAL needs two distinct acts.

1. Amend `LEGAL_INVOCATION_TRANSITIONS`: `POLICY_CHECKED → APPROVED` only for
   `ALLOW` + non-CRITICAL + non-probationary; everything else must pass
   `AWAITING_APPROVAL` and requires an `agency.approvals` row in `approved`.
2. Remove the unconditional `APPROVED` transition in `executor.ts`. On
   `REQUIRE_APPROVAL`: Permission Engine writes `agency.approvals` (pending,
   `required_authorisations`), Notification Manager surfaces it on a trusted
   surface only (`hostTrustTier ∈ {kernel-local, owned-secure}`,
   `authTrustLevel ≥ trusted`; `verified` for CRITICAL), invocation returns
   `outcome: 'awaiting_approval'` and resumes from the approval event.
3. Timeout (15 min default, downward per-capability override) or no trusted
   surface reachable ⇒ `expired` ⇒ `DENIED`, unless the grant carries
   `mayProceedWithoutLiveApproval` for the scope **and**
   `riskClass ≤ maxRiskWithoutLiveApproval` ⇒ `APPROVED` +
   `approval_evidence.kind='standing-grant'`.
4. Dual control: wire `approvalReducer`; `approved` only when both an
   `authorise` (operator) and a `confirm` (typed phrase hash == manifest
   `confirmationPhrase`) event are recorded, same `sessionId`,
   `authTrustLevel: verified`, within TTL. The `confirm` `Command` arrives via
   the H1 ingress. CRITICAL always simulate-first (H2).

**Tests:** REQUIRE_APPROVAL invocation with no approver ⇒ stays pending then
`DENIED` on timeout; with a standing grant ⇒ `APPROVED` with the right
evidence; CRITICAL with only `authorise` ⇒ still pending; with both acts from
different sessions ⇒ rejected; with both from one verified session ⇒ approved.
Moves SECURITY_MODEL §7 / FAILURE_MODEL §4 / T-dual-control to `enforced`.

---

## H5 — Credential Broker hardening + real secret storage (ADR-0035)

**Deliverable:** broker fails closed on missing material; mints only against a
live authority token; `wrapped-static` secrets reach only the out-of-process
worker; a real secrets-file loader with ownership/mode checks.

1. `broker.mint` throws `CredentialUnavailableError` on missing material (no
   `randomUUID()` fallback); Executor ⇒ `FAILED` + `security.alert.elevated`.
2. `FileCredentialMaterialStore`: loads `JARVIS_SECRETS_FILE` once at start;
   refuses a file that is group/other-readable or not owned by the Kernel user
   (POSIX mode / Windows ACL); memory-only; never written back. Keychain
   implementation documented as the next step, same interface.
3. `broker.mint(authorityToken, ...)`: Permission Engine mints a single-use
   `AuthorityToken` (invocation/grant/version/principal bound, ≤120 s, Redis +
   issuance event) only post-freshness-barrier; broker validates + consumes it
   before minting. `dry-run` ⇒ read-only/sandbox credential.
4. `Capability.credentialKind` per action/capability; `derived` where the
   backend supports it (redeemed via `ctx.http`/proxy, worker never sees the
   string); `wrapped-static` ⇒ `SecretBox` over the Adapter Host IPC to the
   **worker** (not the Kernel), `use(fn)`+`zeroize()`, zeroized on exit.
5. `redact.ts`: encoding-aware (raw + base64 + url + hex); wired into every
   worker `ctx.log`, adapter error messages, and `execute_result_debug` before
   persistence; a hit ⇒ `«redacted»` + `security.alert.elevated`.

**Tests:** missing material ⇒ mint throws, invocation `FAILED`, alert emitted;
`JSON.stringify(handle)` never contains a secret (existing test kept); a
`wrapped-static` invocation on the out-of-process path where the worker logs
its secret ⇒ log shows `«redacted»` + alert; an authority token replayed for a
second invocation ⇒ rejected. Moves T22 to `enforced`; F-SEC-3 to built.

---

## H6 — Observability contract (ADR-0036)

**Deliverable:** a real OTel SDK; spans on every ledger-emit site and every
Executor transition; the ASCENSION metric set with a schema; `traceId` on
events; `traceFor(correlationId)` / `eventsFor(traceId)` in diagnostics.

1. `@jarvis/telemetry`: register `sdk-trace-node` + `sdk-metrics` + OTLP
   exporter (batched, async, failure-swallowing); `JARVIS_TELEMETRY=off` kill
   switch; `startTelemetry` in each `main.ts`.
2. Spans (ADR-0036 §2): event fabric, state, context, **every** Executor
   lifecycle transition, broker mint, node admit. One `withSpan` helper per
   transition; child of the interaction root keyed on `correlationId`.
3. Metrics (ADR-0036 §3): typed instruments; wire the ones with a producer
   now; declare the rest `producer: pending` in `docs/architecture/` — do not
   silently omit.
4. `traceId` populated from `currentTraceId()` on every non-TRANSIENT event.
5. Rewrite `infrastructure/observability/README.md` to match **live** coverage;
   update `MK43_IMPLEMENTATION_NOTES.md` §2 OTel row.

**Tests:** a span-coverage fitness test (H12) — every Executor transition
method wrapped; a test that a completed invocation's `correlationId` event tree
and its OTel trace (in-memory exporter) contain the same stage set; a test that
no span attribute is set from `input`/a secret/model content.

---

## H7 — Node Protocol v1 (ADR-0037 Part A)

**Deliverable:** `packages/protocol`; node enrollment/auth/declare/admit/
heartbeat/revoke; `projections.nodes` trust-tier store with enforcement; the
workstation and Adapter Host run as enrolled nodes; session active-endpoint.

1. `packages/protocol`: `NodeDescriptor` (full ASCENSION field set), the
   lifecycle state machine, framing, version negotiation.
2. `apps/core`: enrollment token issue (operator command), CSR signing, cert
   fingerprint in `projections.nodes`, mTLS auth against the registry,
   heartbeat tracker (Redis liveness), `node.revoke`/`node.isolate`.
   `JARVIS_DEV_INSECURE=1` forces every node to `guest`.
3. Enforcement: Event Manager rejects an observation whose `type` ∉ the source
   node's declared `sensors[]` or whose class exceeds the tier ceiling;
   Executor refuses to host below `trustTierMin`; `RESTRICTED` events do not
   propagate below `owned-secure`. A fitness test asserts no code path writes
   `trustTier` from a `NodeDescriptor` field.
4. `apps/adapter-host` + workstation processes: node client + cert;
   `packages/testkit` ships a local CA helper.
5. Session continuity: `Session.activeEndpointNodeId`;
   `session.endpoint_changed` on a presence shift; Notification/voice routing
   follows it; implement the workstation↔one-mobile case.

**Tests:** a node presenting a mismatched cert ⇒ rejected; a `guest` node
emitting an observation ⇒ dropped; an `owned-mobile` node emitting a
non-whitelisted observation ⇒ dropped; `node.revoke` ⇒ subscriptions dropped +
hosted adapters unavailable + in-flight invocations there ⇒
`VERIFICATION_FAILED`. Moves F-SEC-2, F-DIST-1/2 to built; T5, T12 to
`enforced`.

---

## H8 — Compute locality & offline-mode matrix (ADR-0037 context, LOCALITY_MODEL, FAILURE_MODEL)

**Deliverable:** formal L0–L3 locality tiers in code/config; a single
degradation surface JARVIS reports; a composed offline matrix.

1. `docs/architecture/LOCALITY_MODEL.md` §1 tiers L0 device / L1 local core /
   L2 private infra / L3 cloud — encode as a `localityTier` on node
   capabilities and on `ModelRequest` (`locality` already exists); the
   (future) Model Gateway honours it, and the Context Compiler forces
   `≥ prefer-local` when a frame carries `SENSITIVE`/`RESTRICTED` content
   (mechanism stub now, enforced when the gateway exists).
2. A `HealthManager.degradationReport()` that composes: internet, cloud
   models, private server, each node, RTC provider — and yields a
   human-readable line ("Cloud intelligence is unavailable. Local systems
   remain operational."). Surface it in diagnostics and to the Notification
   Manager.
3. `docs/architecture/OFFLINE_MODE.md`: the composed matrix — for each of
   {internet down, cloud down, private server down, one node lost, RTC
   provider down} × {what stays operational, what degrades, what the user is
   told}. Every row must map to a `FAILURE_MODEL.md` behaviour and a test in
   H9/H10.

**Tests:** boot the Kernel with NATS/Redis selectively down and assert
`degradationReport()` text + that the core decision loop still accepts a
state mutation (fail-closed only on PG). Moves F-DIST-3 to built.

---

## H9 — Resilience primitives (ADR-0033 context, FAILURE_MODEL §5)

**Deliverable:** health checks, timeouts, bounded retries, circuit breakers,
dead-letter, idempotency, backpressure, rate limiting, resource quotas,
graceful shutdown, reconnect, event recovery, safe replay — present on the
agency and (stub) cognition paths, not just the spine.

1. A reusable `CircuitBreaker` and `RateLimiter` in `apps/core/src/runtime/`;
   apply the breaker to: every Adapter Host worker call, the (future) Model
   Gateway call, every node channel. Apply the limiter to: proposal ingress
   (per principal), credential mints (per invocation-rate), notification
   delivery.
2. Bounded queue with defined overflow (reject-with-backpressure) on the
   proposal ingress and any agency work queue; a dead-letter subject for
   `jarvis.agency.*` consumer failures (mirror the spine's `PgDeadLetterSink`).
3. Resource quotas: per-invocation wall-time (exists in the host), per-worker
   memory/pids (via `worker+container` — implement it, ADR-0025 §3 / F-AG-5b),
   per-principal concurrent-invocation cap.
4. Graceful shutdown: extend `kernel.stop()` to drain in-flight invocations
   (let `EXECUTING` finish or checkpoint to `COMPENSATING`), stop the ingress
   first.
5. Reconnect + safe replay: Adapter Host reconnects to the Executor channel;
   replayed `jarvis.agency.*` events carry `meta.replay` and reach only the
   projector (the `ReplayBus` guard already exists — assert agency events
   honour it).

**Tests:** a flapping fake adapter trips the breaker and subsequent invocations
fail fast; the proposal queue at capacity rejects with backpressure, not OOM;
`kernel.stop()` during an invocation leaves a recoverable row.

---

## H10 — Chaos tests (ASCENSION "CHAOS TESTS")

**Deliverable:** `pnpm test:chaos` — deliberate breakage of each dependency and
each malformed-input class, asserting the documented behaviour.

Break, one per test, and assert `FAILURE_MODEL.md` behaviour:

- Postgres down mid-operation ⇒ state writes fail closed, reads served stale-
  marked, recovery replays buffered commands.
- Redis down ⇒ ephemeral rebuilt, no authoritative loss, tokens re-acquired.
- NATS down ⇒ Kernel keeps writing PG + outbox, projectors catch up from
  `events`, perception spools then emits a gap marker.
- Internet / model provider down ⇒ external capabilities `denied:
  network_unavailable`, local capabilities normal, degradation reported.
- Webcam / mic / GPU gone ⇒ `perception.<stream>.lost`, others continue, no
  crash (stub until MK.47 perception is real — assert the event contract).
- Kernel Core restart ⇒ cold start < target, orphan invocations compensated.
- Individual node lost ⇒ heartbeat_missed ⇒ unavailable, hosted adapters off.
- Capability provider flaps ⇒ breaker trips.

Input-class chaos:

- Duplicate events / out-of-order events (per-subject) ⇒ idempotent, ordered
  application; cross-subject unordered ⇒ saga handles it.
- Network partition between Kernel and Adapter Host ⇒ invocation times out to
  `VERIFICATION_FAILED`.
- Clock drift (producer `time` far from `recordedAt`) ⇒ ordering still by ULID,
  time-window policy uses injected `context.now`, an alert on large skew.
- Huge context ⇒ Context Compiler truncates at the unit budget, records
  `omitted`, never OOM (also fix F-DATA-3: `readFrom` must page from the
  **tail**, not `'0'`).
- Malicious model output (when cognition exists — stub now) ⇒ Validator
  rejects ⇒ `output_rejected` ⇒ bounded retry.
- Partial action / failed rollback ⇒ `PARTIALLY_COMPLETED` + CRITICAL alert.
- Corrupted response / unknown-higher `schemaVersion` ⇒ quarantined, not fatal.
- Agent timeout ⇒ lease breach recorded, workspace freed.
- Event flood ⇒ bounded queues, drop-oldest-signal, backpressure.

---

## H11 — Performance budgets (ASCENSION "PERFORMANCE BUDGETS")

**Deliverable:** `docs/architecture/PERFORMANCE_BUDGETS.md` with measurable
targets and `pnpm bench` producing numbers + a regression gate.

Set a budget (p50 / p95) and a benchmark for each, on the reference dev box:

| Path | Budget (initial, tune with data) |
|---|---|
| event enqueue → durable (append + outbox tx) | p95 < 15 ms |
| state mutation → subscriber notified | p95 < 25 ms |
| context compilation (typical frame) | p95 < 40 ms |
| policy evaluation (base pack) | p95 < 2 ms |
| freshness barrier transaction | p95 < 20 ms |
| capability verification (world-read, local) | p95 < 150 ms |
| out-of-process worker spawn (cold) | p95 < 120 ms |
| agent startup (when real; stub the harness now) | budget only |
| cold start (MK.42 data volumes) | p95 < 10 s (STATE_MODEL §7) |
| wake → listening / speech-end → first response / hand → pointer / pinch → action | budget only until MK.47/49; record the target |

`pnpm bench` writes `bench/results.json`; a CI job compares against a committed
baseline and fails on >20% regression on any tracked path. No target may be the
word "fast".

---

## H12 — Architecture fitness + contract tests (ADR-0038)

**Deliverable:** `pnpm fitness` and `pnpm test:contract`, CI-blocking; the
capability lint gets an AST pass.

1. `test/fitness/*.fitness.test.ts` — the 12 rules in ADR-0038 §1, using the
   TypeScript compiler API for import-graph and reachability analysis.
   Unbuildable-yet rules are `test.todo` with the rule text; a meta-test
   asserts the `test.todo` count only decreases.
2. `test/contract/*.contract.test.ts` — golden fixtures per `schemaVersion`,
   additive-only structural diff, canonical round-trip, enum freeze, for every
   frozen contract shape (ADR-0038 §2).
3. `packages/capability-sdk/lint`: add a compiler-API pass (resolves aliased
   `process.env`, `fetch`, `child_process`, dynamic `import()`); CI and
   `analyseDraft` use it; reword "enforced by `scripts/lint.mjs`" in
   `SECURITY_MODEL.md` / `threat-model.md` to name the AST pass.
4. CI config: `typecheck`, `lint`, `test`, `fitness`, `test:contract`,
   `test:integration` (with PG service) on every PR; `test:chaos`, `bench`,
   `restore-drill` on a schedule.

---

## H13 — End-to-end demonstration & trace (ASCENSION "END-TO-END DEMONSTRATION")

**Deliverable:** an integration test (`e2e-office-fix.integration.test.ts`) and
`docs/architecture/E2E_TRACE_MK42.md` that walk the ASCENSION 28-step scenario
as far as MK.42 can, honestly, with a single `correlationId` and a matching
OTel trace.

Because perception (MK.47), cognition (MK.45), and the Objective Engine (MK.48)
are not built, **stub the plane inputs, not the pipeline**:

- Steps 1–9 (enter office → "Jarvis" → point at monitor two → "what's wrong"):
  synthesised `Observation` events + a synthetic reference-resolution result
  (`packages/scene` `reference-resolver` already exists — use it) producing a
  bounded `ContextPackage` from the real Context Compiler.
- Steps 13–16 (FORGE bounded assignment → model → evidence-backed diagnosis):
  a **fake** cognition step returns a canned `Proposal` (a
  `CapabilityInvocationProposal` to `filesystem`/`terminal` in a workspace).
  Mark it clearly as a stub.
- Steps 17–28 (**"Fix it"** → plan → policy → permission → execute → tests →
  verify → rollback-if-failed → World Model update → memory candidates → scene
  update → VERIFIED report): **all real** through the wired pipeline (H1–H5).
  The World Model / Memory writes are `jarvis.world.*` / `jarvis.memory.*`
  events with provenance (the ingestion mediator is stubbed to record them —
  or wired if MK.46 services land first).

Assert: one `correlationId` threads every event from the synthetic observation
to `jarvis.agency.invocation.verified`; `traceFor(correlationId)` reconstructs
the same stage tree; a forced verification failure triggers a real, re-verified
rollback and a `VERIFICATION_FAILED` report. Document every place a real plane
was stubbed.

---

## Final review (ASCENSION "FINAL REVIEW")

Run and resolve to green: `pnpm typecheck`, `pnpm lint`, `pnpm test`,
`pnpm test:integration`, `pnpm test:contract`, `pnpm fitness`,
`pnpm test:chaos` (selected), `scripts/restore-drill.mjs`, `pnpm bench` (no
regression).

Then write **`docs/MK42_FOUNDATION_REVIEW.md`** with these sections, each
backed by the tests above:

- **Architecture Compliance Score** (design vs as-built, separately) — with the
  `AUDIT_MK42_ASCENSION.md` findings that moved to `enforced`/`built`.
- **Security Score** — every `threat-model.md` row's `Enforcement` value; the
  count still `design-only` and why.
- **Resilience Score** — chaos-test pass matrix.
- **Observability Score** — span/metric coverage table; which metrics are still
  `producer: pending`.
- **Performance Assessment** — `bench/results.json` vs budgets.
- **Technical Debt** — the MK.43 toolchain deviations still open, with owners
  and a repayment milestone.
- **Known Compromises** — single-box mTLS, keychain-not-HSM, RTC-seam-only,
  cognition/objectives/perception stubbed in H13, any fitness `test.todo` left.
- **Known Risks** — what could still bite in MK.43+.
- **Deferred Work** — explicitly, with the MK it belongs to.
- **Required Fixes Before MK.43** — the blocking subset.
- **Things We Should Deliberately NOT Build Yet** — carry `AUDIT_MK42_ASCENSION.md`
  §13 forward, updated.

The bar: **every control described in `SECURITY_MODEL.md`, `AGENCY_MODEL.md`,
and `threat-model.md` is either enforced by running, tested code, or explicitly
tagged `design-only`.** No control is described in the present tense that the
running system does not perform. That is what "worthy of everything that comes
next" means for MK.42.
