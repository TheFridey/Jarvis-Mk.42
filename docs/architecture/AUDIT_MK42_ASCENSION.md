# MK.42 — Hostile Architecture Audit (ASCENSION, Stage A)

Auditor: external Principal Architect, engaged for the ASCENSION phase. Did not
build this repository. Owes nothing to prior decisions.

Date: 2026-09-03. Commit audited: `431b9e5` on `feat/mk47-hephaestus-safe-agency`
(2 commits ahead of `main` in agency/experience work; `main` is the MK.43
spine).

Method: read the constitution (`PRINCIPLES.md`, `KERNEL_CONSTITUTION.md`, all 20
model documents, ADRs 0001–0030, both protocol specs, the threat model, the
three superpowers specs), then read every implementation file under `apps/*`,
`packages/*`, `capabilities/*`, `infrastructure/*`, and every test. Ran
`pnpm typecheck` (0 errors), `pnpm lint` (clean), `pnpm test` (100 unit tests
pass). Cross-checked each claimed structural control against the code that is
supposed to enforce it **and against the code that actually runs**.

This document is subordinate to `PRINCIPLES.md`. It does not change a law. It
records where the system as-built diverges from the constitution, ranked by
risk, and lists the ADRs and the hardening specification that close the gaps.

---

## 0. Executive verdict

**The MK.43 spine is real, disciplined, and worth building on.** Event fabric,
State Manager, identity, sessions, presence, health, scheduler, notifications,
modes, and the deterministic Context Compiler are implemented as ratified:
transactional outbox, single-writer projectors, optimistic concurrency under a
row lock, schema-validated envelopes, replay ≠ re-execution, fail-closed on
write when PostgreSQL is down. Nothing in section 1 below is a spine defect.

**The HEPHAESTUS Agency Plane is architecture theatre.** ADR-0025–0030 and the
design spec describe a correct, hostile-grade safe-agency system. The code that
was committed under those ADRs is a set of **unwired, in-memory, partial
modules**. `CapabilityExecutor`, `CredentialBroker`, `PermissionManager`,
`CapabilityRegistry`, and `SentinelDetectorService` are imported by **nothing**
— not by `apps/core/src/kernel/lifecycle/kernel.ts`, not by any test that
exercises a pipeline, not by each other. The running Kernel has no Executor, no
policy enforcement path, no Objective Engine, no Agent Runtime, no Model
Gateway, no proposal ingress. Every threat-model row T16–T28 that says
"structurally mitigated by the Executor pipeline" is, in the running system,
**not mitigated by anything**, because there is no running Executor.

Worse than "not built yet": several of the committed agency modules **contain
the shape of a control with the enforcement removed** — auto-approval of
`REQUIRE_APPROVAL`, self-verification by the adapter, in-process adapter
execution, a credential broker that fabricates a random secret when none is
configured. A reader of `threat-model.md` would believe these threats are
handled. They are not. That is the most dangerous state a security architecture
can be in: **confidently documented, silently hollow.**

**The ASCENSION subject matter — distribution, node security, offline mode,
resilience primitives, observability, chaos tests, performance budgets, backup,
retention enforcement, contract tests, fitness tests — is almost entirely
undelivered.** OpenTelemetry is a no-op shim. There is no Node Protocol code.
There is no backup or restore mechanism beyond a sentence in `STATE_MODEL.md`.
There are no chaos tests, no performance budgets, no contract-compatibility
tests, and the sole "architecture fitness test" is a three-line `grep` over one
file.

**Build order abandoned the ROADMAP.** The ROADMAP sequence is MK.43 spine →
MK.44 authority → MK.45 cognition → MK.46 knowledge → MK.47 perception → MK.48
objectives → MK.49 experience. The repository instead has half-built MK.46
(knowledge schema + contracts, no services), MK.47A (perception core), MK.49
(a disconnected desktop demo), and HEPHAESTUS (MK.44+50 collapsed) all stacked
on an MK.43 kernel that still hard-codes `activeObjectiveCount: 0`. Agency was
built before the thing that would ever call it.

**Scores** (rationale in §12, methodology in the FOUNDATION_REVIEW template):

| Dimension | Score /10 | One-line reason |
|---|---|---|
| Architecture compliance (design) | 9 | The documented architecture is coherent, law-anchored, and genuinely good. |
| Architecture compliance (as-built) | 4 | The spine matches; the agency plane, cognition, objectives, nodes do not exist as running code. |
| Security (as-built) | 3 | Enforcement path unbuilt; documented controls hollow; broker fabricates secrets; approval is a no-op. |
| Resilience (as-built) | 5 | Spine degrades correctly; agency lifecycle non-durable; no circuit breakers/backpressure on the agency side; no chaos coverage. |
| Observability (as-built) | 2 | `@opentelemetry/api` no-op only; no spans, no metrics, no trace correlation in practice. |
| Distributed readiness | 2 | Message boundaries exist in contracts; no Node Protocol implementation, no node identity, no multi-node anything. |
| Test integrity | 4 | 100 green unit tests, but zero exercise the Executor pipeline; security tests test pure helpers, not the system. |

MK.42 is **not** ready to be called a foundation for fifty generations. The
spine could be. The rest is a specification wearing an implementation's commit
messages.

---

## 1. The spine — what is genuinely sound (credit where due)

An honest hostile audit records what it could not break.

- **S1. One authoritative state, enforced.** `StateManager.mutate` validates
  the slice schema, takes a `FOR UPDATE` row lock on the slice version, checks
  optimistic concurrency, emits `state.mutated` and writes the new value in one
  transaction, bumps a monotonic global version. Two writers on the same base
  version: exactly one wins. This is correct.
- **S2. Transactional outbox, correct.** `EventManager.emit` /`emitInTx` append
  to `events` + enqueue the outbox row in one transaction; the relay publishes
  after commit; consumers are idempotent on `Event.id`; TRANSIENT never
  persists. Losing NATS does not lose or corrupt state.
- **S3. Replay ≠ re-execution is structural.** A dedicated `ReplayBus` that
  only projector consumers subscribe to; replayed events carry `meta.replay`.
- **S4. Envelope validation at append.** `@jarvis/validation` runs on every
  event; malformed events are rejected and self-reported as `event.rejected`
  (DIAGNOSTIC) without recursion.
- **S5. Deterministic Policy Engine (the library).** `evaluatePolicy` is a pure
  function: hard caps first (untrusted-derived ≥ MEDIUM ⇒ DENY; missing scope ⇒
  DENY; GUARDIAN+CRITICAL ⇒ DENY), then rules by priority with DENY-wins, then a
  fail-closed default (AMBIENT⇒ALLOW, LOW⇒REQUIRE_APPROVAL, else DENY). Rule
  validation rejects a non-DENY rule that reads `llmRecommendation` and rejects
  an ALLOW rule that branches on mode/objective. `context.now` is injected, not
  read. `safePattern` blocks catastrophic regex. This module is good.
- **S6. Modes are a posture, not an authority.** The transition table is
  deterministic with dwell hysteresis and guards; GUARDIAN mode changes are
  SECURITY-class. `AUTONOMOUS` cannot convert `REQUIRE_APPROVAL` to `ALLOW` in
  the policy library.
- **S7. Identity is honest about what it cannot do.** `voice`/`biometric` auth
  returns `method_unsupported` rather than a fake pass.
- **S8. The MK.49 diagnostics panel was corrected** (commit `431b9e5`) to show
  `UNAVAILABLE` rather than invented telemetry. Good instinct; see F-EXP-1 for
  the larger context.

These are the assets the rest of this audit is trying to protect.

---

## 2. Agency Plane — architecture vs. running reality

Severity key: **CRITICAL** = a documented security guarantee is false in the
running system; **HIGH** = a load-bearing control is stubbed or unwired;
**MEDIUM** = correctness / robustness gap; **LOW** = hygiene.

### F-AG-1 (CRITICAL) — The Executor pipeline does not run. Nothing wires it.

`grep` for importers of `CapabilityExecutor`, `CredentialBroker`,
`PermissionManager`, `CapabilityRegistry`, `SentinelDetectorService`: the only
hit anywhere is `guardian-playbook.ts` referencing an *injected interface*, and
`guardian-playbook.ts` is itself imported by nothing. `kernel.ts` constructs
event-fabric, state, mode, identity, session, presence, health, scheduler,
notification, context, diagnostics — and stops. There is no Executor instance,
no policy rule store load, no grant store, no broker material load, no adapter
host process, no Sentinel loop, no proposal ingress channel.

Consequence: `AGENCY_MODEL.md`, `SECURITY_MODEL.md` §3–§8, and threat-model
T16–T28 describe a pipeline that **is not present at runtime**. "Every
consequential action is a capability invocation through one pipeline" (L18) is
vacuously true only because *no* consequential action is possible at all.

Verdict: the agency plane must be either (a) wired into the running Kernel and
covered by an end-to-end pipeline test before any doc or threat-model row
claims it as a control, or (b) explicitly marked `Status: inert / not wired`
in every document, with the threat-model rows downgraded to "design only".
There is no acceptable third state. → **ADR-0031**.

### F-AG-2 (CRITICAL) — `REQUIRE_APPROVAL` auto-approves. No operator, no dual control, no fail-closed.

`executor.ts`:

```ts
if (policy.verdict === 'REQUIRE_APPROVAL') await this.transition(id, 'AWAITING_APPROVAL', 'awaiting_approval');
await this.transition(id, 'APPROVED', 'approved');
```

The `AWAITING_APPROVAL` state is entered and immediately left for `APPROVED`
unconditionally. There is no `ApprovalRequest`, no Notification surface, no
timeout, no `mayProceedWithoutLiveApproval` check, no confirmation phrase, no
`requiredAuthorisations` consumption. `PermissionManager.requiredAuthorisations`
returns `2` for CRITICAL and **nothing reads it**. `approvalReducer` (a correct
pure dual-control reducer) exists in `@jarvis/permissions` and **nothing calls
it**.

Consequence: `SECURITY_MODEL.md` §7, `FAILURE_MODEL.md` §4, ADR-0027 §"Approval
workflow" / §"Dual control", and L19 are all contradicted. A CRITICAL action —
`financial_transfer`, `drop_production`, `robotics-motion` — flowing into this
executor would be auto-approved. The "operator-unreachable ⇒ fail closed"
guarantee is inverted: operator-*absent* ⇒ proceed. → **ADR-0034**.

### F-AG-3 (CRITICAL) — Verification trusts the adapter. This is the exact "fake verification" T27 claims to prevent.

`verify-runner.ts` in full:

```ts
export function runVerification(adapter, action, ctx, input, output, strategy) {
  return adapter.verify(action, ctx, input, output, strategy);
}
```

`verify` is a method on the **same adapter object** that just executed the
effect, called **in-process**, with the **same full-credential `ctx`** (not a
read-only credential). The manifest's `verificationStrategy` (`world-read`,
`event-await`, `hash-match`, `health-probe`, `state-echo`) is passed to the
adapter and never interpreted by the Executor. A compromised or buggy adapter
returns `{ verified: true }` and the invocation transitions to `COMPLETED` and
writes World Model facts with `epistemicStatus: observed`.

`AGENCY_MODEL.md` §10: "`verify` is mandatory and **Executor-run** against the
world using a read-only credential — the adapter's `execute` return value ...
is a debug field only." Threat-model T27: "the adapter's `execute` return value
(and any HTTP 200) is a debug field only and never flips the state to
`COMPLETED`." Both false as-built. → **ADR-0032**.

### F-AG-4 (CRITICAL) — Simulation result is discarded; no simulated-effect approval gate.

`executor.ts`: for `riskClass ∈ {HIGH, CRITICAL}` and `simulatable`, it mints a
dry-run credential, calls `adapter.simulate(...)`, **throws the result away**,
and transitions straight to `EXECUTING`. There is no `PredictedEffect`
surfaced, no operator approval of the predicted effect, no
`predicted_effect_ref` persisted (the column exists in `0008_agency.sql` and is
never written). `AGENCY_MODEL.md` §3 ("`PredictedEffect -> approval`") and L24
("requires the simulated effect to be presented for approval") — not enforced.
→ **ADR-0032**.

### F-AG-5 (HIGH) — Adapters execute in-process. The Adapter Host exists and is unused.

`executor.ts` calls `this.deps.adapter(capability)` and invokes
`.execute()` / `.verify()` / `.rollback()` / `.simulate()` on the returned
`AdapterRunner` **in the Kernel process**. `apps/adapter-host` (real
`child_process.spawn` worker, zero-inherited-env, stdout IPC) is imported by
nothing in `apps/core`. ADR-0025 §3 and ADR-0016 both make out-of-process
adapter execution non-negotiable ("Adapters as in-process modules for this
phase ... Rejected outright"). As-built, a compromised adapter shares Kernel
memory, the Kernel DB handle, and the NATS publish credential. → **ADR-0031**,
**ADR-0033**.

Sub-findings on the Adapter Host itself (for when it *is* wired):
- **F-AG-5a (MEDIUM)** IPC is "parse the child's entire stdout as JSON". Any
  stray `console.*` or library banner in the worker corrupts the frame. Needs a
  length-prefixed or newline-delimited typed channel.
- **F-AG-5b (MEDIUM)** `worker+container` throws `'container runner required'`
  — unimplemented. `restrictedDockerArgs` is a pure function nobody calls.
- **F-AG-5c (MEDIUM)** `cwd: process.cwd()` — the worker runs in the Kernel's
  working directory and can `readFileSync` the whole repo, not a fresh scratch
  dir (ADR-0025 §3).
- **F-AG-5d (HIGH)** `wrapped-static` credentials cannot function
  out-of-process: the secret lives in the broker process, the worker has no IPC
  back to the broker, and `SecretBox`/`use(fn)` over IPC (ADR-0025 §2) is not
  implemented. So egress-needing adapters are simply broken (`ctx.http` throws
  everywhere).

### F-AG-6 (HIGH) — Invocation lifecycle is an in-memory `Map`. No durability, no saga recovery.

`InvocationStore` is `private readonly rows = new Map<string, InvocationLifecycle>()`.
`ResourceLeaseManager` is `private readonly held = new Map<string, string>()`.
`MemoryGrantStore` is a `Map`. Migration `0008_agency.sql` defines
`agency.invocations`, `agency.invocation_steps`, `agency.resource_leases`,
`agency.grants`, `agency.approvals`, `agency.credential_grants` — **none are
read or written by any code**.

Consequences:
- Kernel restart loses every in-flight invocation. `orphaned()` scans an empty
  map. The "restart recovery: `EXECUTING` row with no terminal event ⇒ run
  compensation" (ADR-0025 §"Benefits", `FAILURE_MODEL.md` §Kernel restarts,
  L23, T28) does not happen.
- The resource lease is per-process and in-memory: no mutual exclusion across
  Kernel instances or Adapter Host nodes, no `FOR UPDATE`, no TTL. T28's
  "`resourceKey` mutual-exclusion lease (`FOR UPDATE`)" is false.
- The lifecycle is not "folded from the `jarvis.agency.invocation.*` event
  stream" (ADR-0025 §1). The Executor emits bespoke events via an
  `ExecutorEventSink` that is not the real `EventManager` (no `correlationId`
  wiring beyond a passthrough, no `causationId`, no `provenance`, no
  `privacyClass`, no `principalId`, no envelope validation). So T21 ("only
  Kernel components hold the ledger-publish credential; `agency.invocation.*`
  accepted only from the Executor's `source`") has no enforcement surface —
  there is no real event to validate a `source` on.
→ **ADR-0033**.

### F-AG-7 (HIGH) — The freshness barrier is not in a transaction with `capability.started`.

`executor.ts` does, in sequence, with no transaction wrapping any of it:
`permission.freshnessCheck(grantId, grantVersion)` → acquire in-memory lease →
`transition('EXECUTING', 'started')`. ADR-0027 §"Freshness barrier" is explicit:
the `SELECT version, revoked_at ... FOR SHARE`, the lease `FOR UPDATE`, and the
`capability.started` append must be **one transaction**. As-built there is a
TOCTOU window between the freshness check and the started event, and the
"freshness check" is a `Map` lookup against a `Map`-backed grant store.
→ **ADR-0033**, **ADR-0034**.

### F-AG-8 (HIGH) — Credential Broker fabricates a secret when none is configured.

`broker.ts`: `const secret = await this.material.get(provider) ?? randomUUID();`
A missing credential silently becomes a random one and the mint "succeeds". A
misconfigured broker therefore produces `derived` handles that sign requests
with garbage and `wrapped-static` handles that hand a random string to adapter
code — no error, no alert. The broker must **fail closed** on missing material.
Additional:
- **F-AG-8a (MEDIUM)** `kind` is decided by `provider === 'github' || provider === 'docker'`
  hard-coded in the broker, not by the manifest. Every other provider gets
  `wrapped-static` and, on the in-process path, `use: fn => fn(secret)` hands
  the real secret string to the adapter with no redactor on `ctx.log` (it is
  `() => undefined`).
- **F-AG-8b (MEDIUM)** No authority-token gate on `mint`. ADR-0027 says the
  broker "mints only against a live, unexpired, unconsumed token for that
  `invocationId`". As-built `mint` takes an `invocationId` string and trusts
  it.
- **F-AG-8c (LOW)** `makeRedactor` splits on exact secret substring — misses
  base64/url-encoded/partial leakage — and is not wired into the in-process
  executor context anyway.
→ **ADR-0035**.

### F-AG-9 (HIGH) — Capability registration and probation promotion have no real operator gate.

`CapabilityRegistry.register(manifest, artifactHash, registeredBy)` —
`registeredBy` is an unchecked string. `promoteCapability` checks
`approval.authTrustLevel === 'verified' && approval.signature` but the
`signature` is never cryptographically verified — any truthy string passes —
and callers can bypass `promoteCapability` and call `registry.register`
directly. `clearProbation(id)` (the "second operator `capability.trust`
Command" per ADR-0029) takes an id and nothing else. `AGENCY_MODEL.md` §12 /
threat-model T23: "registration only by the Capability Registry, never
automated ... a second operator capability.trust Command". As-built there is no
structural difference between an operator promotion and an automated one.
→ **ADR-0031** (wiring + Command channel), **ADR-0034** (operator-act
semantics).

### F-AG-10 (MEDIUM) — Resource-lease key ignores the manifest `resourceKeySelector`.

`executor.ts`: `const resource = initial.capabilityId + ':' + JSON.stringify(proposal.invocation.input);`
Two invocations mutating the same file/branch/container with different input
shapes (e.g. an absolute vs. relative path, a differently-ordered object) get
different lease keys and do **not** mutually exclude. The manifest field
`resourceKeySelector` (`capability.ts`) exists precisely to extract the real
resource identity and is unused. → **ADR-0033**.

### F-AG-11 (MEDIUM) — `principalId` / `onBehalfOf` is trusted from the proposal actor.

`executor.ts`: `principalId: origin.onBehalfOf ?? origin.id`. Nothing verifies
that an `actor.kind === 'agent'` was actually leased on behalf of that
principal. The confused-deputy mitigation (T20, T25) depends entirely on
whoever constructs the `EventActor`, and there is no Agent Runtime doing that
construction under a lease. When the Agent Runtime is built it **must** be the
sole minter of agent actors and must stamp `onBehalfOf` from the lease, not
from agent-supplied data. → **ADR-0031** (call out as a wiring precondition).

### F-AG-12 (MEDIUM) — Sentinel and Guardian are inert.

`SentinelDetectorService.detect(events[])` is a pure function that takes an
array someone must pass it. Nothing subscribes it to the event stream, writes
`agency.security_alerts`, or calls `guardianEligible`. `runGuardianPlaybook`
takes a `GuardianExecutor` interface and is imported by nothing; its capability
ids (`capabilities.permission`, `capabilities.agency_control`, `capabilities.audit`,
`capabilities.node`, `capabilities.notify`) have no manifests. Detector names
diverge from `SENTINEL_MODEL.md` (`auth.unexpected-node` vs `auth.new-node`;
`auth.impossible-context` missing). `cap.rate-anomaly` uses a fixed count, not
"exceeds a rolling baseline by factor K". → **ADR-0031**, hardening spec H-OBS
and H-SEC.

### F-AG-13 (MEDIUM) — The security lint is a text regex presented as a structural control.

`packages/capability-sdk/lint/capabilities-lint.mjs` is `RegExp.test(source)`.
`process\.env\.(?!NODE_ENV\b)` misses `process.env['SECRET']`, `const e = process.env; e.X`.
`bare-fetch` misses `globalThis.fetch`, aliasing, dynamic import of
`node:child_process`. `verify` presence is "the string `verify(` appears once
in the file". `SECURITY_MODEL.md` and `threat-model.md` repeatedly cite
"enforced by ... `scripts/lint.mjs`" as a **structural** mitigation (T22, T23,
T24, Sentinel section). A regex over source text is a speed bump, not a
boundary. Either back it with an AST check (typescript compiler API, already a
dependency) or stop calling it structural. → **ADR-0038**.

---

## 3. Security boundaries that currently exist only on paper

### F-SEC-1 (CRITICAL) — The threat model asserts mitigations that are not wired.

`docs/security/threat-model.md` T16–T28 each end with a confident structural
claim. Cross-checked against running code: T16 (no Executor to re-enter),
T19/T20 (no Executor calling the policy engine), T21 (no real agency events),
T22 (broker unwired, redactor unwired), T23 (registration gate absent), T24
(terminal adapter not invoked through anything), T25 (grant store is a `Map`,
never consulted at runtime), T26 (rollback verified by the adapter itself),
T27 (see F-AG-3), T28 (in-memory lease). **Every one of these is currently
"design only".** The threat model must carry an enforcement-status column and
must not describe a mitigation in the present tense until a test proves the
running system enforces it. → **ADR-0031**, **ADR-0039** folded into 0031.

### F-SEC-2 (HIGH) — Node trust is a documented enum with no code.

`SECURITY_MODEL.md` §6 and `node-protocol.md` define `kernel-local` /
`owned-secure` / `owned-mobile` / `guest` tiers, mTLS admission, "cannot
self-upgrade", per-tier observation acceptance and capability ceilings. There
is **no `packages/protocol`**, **no `NodeDescriptor` handler**, **no node
registry writer**, **no admission flow**, **no heartbeat**, **no
`node.isolate`**. `contracts/src/node.ts` exists; nothing consumes it. Every
multi-device, AR, and robotics claim (L35, L37, L38) rests on this unbuilt
protocol. → **ADR-0037**.

### F-SEC-3 (HIGH) — No secret storage mechanism exists; "OS keychain / 0600 file" is a sentence.

`DATA_OWNERSHIP.md` and `SECURITY_MODEL.md` §5 say secrets live in the OS
keychain or a `0600` secrets file, loaded only into the Credential Broker.
There is no keychain integration, no secrets-file loader, no file-mode check,
no `MemoryCredentialMaterialStore` production counterpart. The bootstrap
operator credential path (`config.bootstrapCredential`, scrypt) is the only
real secret handling in the repo. → **ADR-0035**, hardening spec H-SEC.

### F-SEC-4 (MEDIUM) — mTLS, TLS, encryption-at-rest are asserted, not configured.

`SECURITY_MODEL.md` §9 asserts PG/object-storage encryption at rest and mTLS on
every node↔Kernel link. `infrastructure/docker/local-server.compose.yml` and
the OTel collector config are the only infra files with content; there is no
TLS config, no cert issuance, no `pg` sslmode, no MinIO encryption flag. For a
single-box LAN dev stack this is acceptable *today*, but it must be tracked as
a known compromise, not left implied-done. → hardening spec H-SEC.

### F-SEC-5 (LOW) — `path.resolve` in the policy/constraint evaluators depends on `process.cwd()`.

`ast.ts` `path-under` and `constraints.ts` `path-prefix` call `path.resolve`
without a base, so a relative `prefix`/`value` resolves against the Kernel's
current working directory — an environment input into a function that L20 says
must be a pure function of typed inputs. Require absolute prefixes at rule/grant
validation time. → hardening spec H-SEC.

---

## 4. Distribution & node readiness — undelivered

### F-DIST-1 (HIGH) — There is no node anything.

Beyond F-SEC-2: no `nodeId` provenance separation in practice (every event
`source.node` is `config.nodeId`, a constant), no per-node NATS credential
scoping, no `owned-mobile`/`guest` observation filtering, no
`RESTRICTED privacyClass` cross-node propagation control (the field is set on
events and read by nothing), no relay seam beyond an empty `apps/relay`
README. The claim "every distribution boundary is already a message boundary"
is true only at the *contract* level; no boundary has a second process on the
other side. → **ADR-0037**, hardening spec H-NODE, H-CONT.

### F-DIST-2 (MEDIUM) — Session continuity across devices is undesigned.

The ASCENSION prompt calls for a session moving from office PC to phone without
forking JARVIS identity or authoritative state. `session.ts` has `handoff`
fields and `parent/child`; `SessionManager` has the state machine; but there is
no handoff protocol, no "active endpoint" concept, no presence-driven endpoint
switch. This is a design gap, not just an implementation gap. → hardening spec
H-NODE.

### F-DIST-3 (MEDIUM) — Offline mode is described per-dependency but never composed or tested.

`FAILURE_MODEL.md` and `LOCALITY_MODEL.md` §4 describe degradation per
dependency. There is no single "what is operational when internet + cloud +
private server + one node + RTC are simultaneously down" matrix, no
`degradationState` surface a user sees, and no test that boots the Kernel with
NATS/Redis/PG selectively unavailable and asserts the documented behaviour
(the integration tests self-skip without Docker; none inject partial failure).
The Kernel's own accurate self-report ("Cloud intelligence is unavailable.
Local systems remain operational.") does not exist as a code path. → hardening
spec H-OFFLINE, H-CHAOS.

---

## 5. Observability — a no-op shim

### F-OBS-1 (HIGH) — OpenTelemetry is `@opentelemetry/api` with no provider. Nothing is instrumented.

`packages/telemetry` header says it plainly: "Without a registered
TracerProvider the API returns no-op spans." `startTelemetry` is an empty
function. `withSpan` runs the callback with a no-op span. `currentTraceId()`
returns `undefined`, so the `traceId` field the envelope reserves is never
populated in practice. There are **no metrics** — the collector config has a
metrics pipeline with no producers. `infrastructure/observability/README.md`
describes end-to-end tracing, per-class append rate, projector lag, JetStream
pending, capability outcomes, model cost — **none of which are emitted**.

The ASCENSION prompt requires "Complete OpenTelemetry coverage" and a
correlated trace from user input → RTC → context → agent → model → capability →
verification → response. As-built there is no first span. → **ADR-0036**.

### F-OBS-2 (MEDIUM) — No correlation between the event ledger and traces.

`EVENT_ARCHITECTURE.md` §6 promises `traceId` on the envelope for
cross-referencing an OTel trace with an `AuditTrace` by `correlationId`. With
no SDK, every `traceId` is absent. The audit-vs-trace join is undeliverable
until F-OBS-1 is fixed. → **ADR-0036**.

### F-OBS-3 (MEDIUM) — Diagnostics API surfaces only what the spine has; no agency/model/RTC/memory metrics.

`DiagnosticsService` reports mode, uptime, event rate, sessions, nodes, PG/
Redis/bus state, health. Model-gateway/RTC/memory rows are `placeholder: true`.
Correct and honest for MK.43, but the ASCENSION metric list (voice latency,
hand latency, model cost, verification-failure rate, policy denials, memory
growth, World Model growth, RTC quality) has no producer and no schema.
→ hardening spec H-OBS, H-PERF.

---

## 6. Resilience & recovery — partial

### F-RES-1 (HIGH) — Resilience primitives exist for the spine only.

`FAILURE_MODEL.md` §5 lists timeouts, circuit breakers, bounded queues,
backpressure, graceful shutdown. The spine has: bounded outbox batch, retry
with backoff, dead-letter, `isPaused` scheduler gate, SIGINT/SIGTERM drain. The
agency side has: an adapter `timeoutMs` (`setTimeout` + `child.kill()` in the
*unwired* host). There is **no circuit breaker** anywhere (the Model Gateway
that would need one does not exist), **no rate limiter**, **no resource quota**,
**no backpressure** on a proposal channel (there is no proposal channel), **no
dead-letter for agency events**. → hardening spec H-RESIL.

### F-RES-2 (MEDIUM) — Idempotency is claimed for commands/consumers but the agency path has none.

`EVENT_ARCHITECTURE.md` §5: "Commands carry a client-generated `commandId`; the
Kernel dedupes." There is no command ingress and no `commandId` dedupe table.
`executor.ts` generates a fresh `randomUUID()` per `invoke` call — a retried
proposal executes twice. `idempotencyKeySelector` in the manifest is unused.
→ **ADR-0033**.

### F-RES-3 (MEDIUM) — Rollback is single-shot and adapter-verified; no saga, no residual escalation.

`executor.ts` calls `adapter.rollback(...)` once on verification failure of a
reversible action and transitions to `ROLLED_BACK` **without re-verifying the
undo** (`RollbackReport.undone` is defined and unused). `saga.ts` is a
one-line `compensateSteps` helper the Executor never calls; `steps[]` handling
is entirely absent. "residual items ⇒ CRITICAL alert + GUARDIAN recommendation"
(T26) does not exist. → **ADR-0032**, **ADR-0033**.

### F-RES-4 (LOW) — Cold-start timing is unmeasured.

`STATE_MODEL.md` targets `< 10 s`. `MK43_IMPLEMENTATION_NOTES.md` §5 says
"timing to be measured against real volumes". No benchmark exists. → hardening
spec H-PERF.

---

## 7. Data lifecycle — retention, backup, growth

### F-DATA-1 (HIGH) — No backup or restore mechanism, and no test of one.

`STATE_MODEL.md` §8 describes WAL archiving + nightly base backup + object-
storage sync + "recovery = restore + cold start". There is **no backup script,
no restore runbook, no `pg_basebackup`/WAL config, no drill**. The ASCENSION
prompt is explicit: "JARVIS's accumulated knowledge cannot disappear because a
disk fails ... Test restoration." Nothing here would survive a disk failure.
→ **ADR-0037** (or a dedicated ADR — see hardening spec H-BACKUP).

### F-DATA-2 (MEDIUM) — Retention classes are defined and only partially enforced.

`RetentionSweeper` exists and is scheduled. It is the one real enforcement
point. But: TRANSIENT is "never persisted" only if every producer sets the
class correctly (no lint/CI check that a `perception.*` event is TRANSIENT);
`facts_archive` archival is "a background job" that does not exist (no ATLAS
service); MNEMOSYNE decay/forget is unbuilt (no MNEMOSYNE service); the
`expiresAt` hint is read by nothing. The ASCENSION retention list (raw audio,
raw video, screenshots, traces, model outputs) has no policy object and no
enforcement. → hardening spec H-RETAIN.

### F-DATA-3 (MEDIUM) — Context Compiler reads the *oldest* events, forever.

`context-compiler.ts`: `this.deps.eventStore.readFrom('0', 40)` then
`.slice(-20)`. `readFrom('0', ...)` returns the first 40 events ever recorded.
As the log grows, the "recent events" tier of every ContextPackage is
permanently pinned to genesis events. This is a straightforward correctness
bug and a context-quality bug. It also means the "context explosion" guard the
self-review is proud of (§16.12) has never actually been exercised against a
realistic event volume. → hardening spec H-PERF / correctness backlog.

### F-DATA-4 (LOW) — `input_hash` uses `JSON.stringify` (key-order-sensitive) for idempotency and audit.

`executor.ts` and `state-manager.ts` hash `JSON.stringify(value)`. Two
semantically-identical inputs with different key order hash differently —
weakens idempotency dedupe and audit correlation. Use a canonical
serialization. → hardening spec H-CONTRACT.

---

## 8. Build order & process drift

### F-PROC-1 (HIGH) — Agency was built before anything can call it.

HEPHAESTUS (ROADMAP MK.44 + MK.50) landed before MK.45 Cognition, MK.46
Knowledge *services*, and MK.48 Objectives. The Executor's inputs — a
`CapabilityInvocationProposal` from a Validator, an `EventActor` from an Agent
Runtime lease, a policy `context` assembled from real grants and mode — have no
producer. This is why the Executor is unwired: **there is nothing upstream of
it.** The result is ~15 agency source files and an 11-table migration that
cannot be integration-tested end to end because half the pipeline's collaborators
do not exist.

Recommendation: freeze new agency *breadth* (no more adapters, no FORGE
polish). Spend ASCENSION making the *existing* agency spine load-bearing:
wire it to the Kernel behind a minimal synthetic proposal ingress, build the
durable stores, and prove one real capability (`filesystem` write in a
workspace) end to end through the true pipeline with an out-of-process worker,
real approval, and Executor-run verification. That is the MK.44 exit criterion
that was skipped. → **ADR-0031**.

### F-PROC-2 (MEDIUM) — `MK43_IMPLEMENTATION_NOTES.md` toolchain deviations have compounded, not been repaid.

NestJS, ESLint, OpenTelemetry SDK, testcontainers, `exactOptionalPropertyTypes`
were all deferred "when the toolchain allows" in MK.43. Three phases later, all
five are still deferred, and the OTel one now directly blocks an ASCENSION
requirement. The "external USB drive" justification should be revisited
(node_modules is present now; `pnpm test` runs in 4.5 s). At minimum, the
deviations need owners and a repayment milestone. → hardening spec H-OBS
(OTel), FOUNDATION_REVIEW "known compromises".

### F-PROC-3 (MEDIUM) — Design spec component map does not match the tree.

The HEPHAESTUS design spec §2 places the Policy Engine at
`apps/core/src/kernel/policy/`. That directory does not exist; the policy
engine is `packages/permissions/src/policy/`. Small, but it is the kind of
drift that means the spec was not re-read against the tree after
implementation. → **ADR-0031** requires spec/tree reconciliation as an exit
gate.

### F-EXP-1 (LOW) — MK.49 "experience" is a disconnected demo.

`apps/desktop/src/experience/*` runs a `LocalSceneTransport` over a hard-coded
`demoScene` with a `localStorage` layout cache. There is no SDK, no WebSocket,
no `Command`/`Proposal` submission, no Kernel connection. It is a design
prototype, and (post-`431b9e5`) an honest one about telemetry. But it is not
the MK.49 exit criterion ("interfaces hold zero authoritative state; all
mutation via validated commands") because there are no commands. Label it
`Status: prototype` and do not count it toward MK.49. → doc-honesty item under
**ADR-0031**.

---

## 9. Contract & fitness testing gaps

### F-TEST-1 (HIGH) — Zero tests exercise the Executor pipeline.

100 unit tests. `agency.security.test.ts` tests `evaluatePolicy`,
`validateManifest`, `checkResourceConstraints`, `advance`, and `CredentialBroker`
**as isolated pure functions**. `boundary-sweep.test.ts` greps two source
files. There is no test that constructs a `CapabilityExecutor` with fakes and
asserts: DENY ⇒ terminal DENIED; REQUIRE_APPROVAL ⇒ does not proceed without an
approval; simulate result surfaced; verify run by the Executor not the adapter;
freshness failure ⇒ ABORTED; crash mid-execute ⇒ recoverable. The security
suite gives false confidence. → **ADR-0038**, hardening spec H-TEST.

### F-TEST-2 (HIGH) — No contract-compatibility / versioning tests.

`ROADMAP.md` invariant: "contracts are versioned; they version additively."
There is no golden-file test of any contract shape, no `schemaVersion`
round-trip test, no check that a new field is optional, no cross-version
consumer test. `EVENT_ARCHITECTURE.md` §9 governance is unenforced. The event
envelope, `Capability`, `NodeDescriptor`, `ModelRequest`, `Fact`, policy AST,
and agency lifecycle contracts all need locked shapes. → **ADR-0038**,
hardening spec H-CONTRACT.

### F-TEST-3 (MEDIUM) — Architecture fitness = one grep.

`boundary-sweep.test.ts` checks `executor.ts` does not contain the string
`capabilities/`. That is the entire automated defense against architectural
decay. The ASCENSION prompt lists nine fitness rules (Kernel cannot import
provider code; agents cannot access domain repos; UI cannot become
authoritative; capabilities cannot bypass policy; critical actions cannot
self-complete; World Model cannot write Kernel authority; Memory cannot become
World Model truth; raw frames cannot go to cloud by default). None are checked.
→ **ADR-0038**, hardening spec H-FITNESS.

### F-TEST-4 (MEDIUM) — Integration tests self-skip and cover only the spine.

`apps/core/test/*.integration.test.ts` need Docker and self-skip otherwise;
they cover event fabric, state, knowledge schema, kernel lifecycle. No agency
integration test exists. CI status of integration tests is unknown (no CI
config in the repo). → hardening spec H-TEST.

---

## 10. Smaller correctness findings (backlog, not blocking)

- **C1.** `evaluate.ts` `inWindow` string-compares `hhmm >= from` — a
  time-window crossing midnight (e.g. 22:00–02:00) never matches.
- **C2.** `evaluate.ts` selects `deny ?? matches[0]` after sorting; if the
  highest-priority rule is `REQUIRE_APPROVAL` and a lower-priority `ALLOW`
  exists, `matches[0]` is the REQUIRE_APPROVAL — correct — but two equal-priority
  non-DENY rules resolve by `id.localeCompare`, which is arbitrary policy
  behaviour dressed as determinism. Document tie-break as intentional or add an
  explicit precedence field.
- **C3.** `registry.ts` probation `lookup` raises `riskClass` per action but
  leaves `simulatable` untouched; a probationary non-simulatable HIGH action
  still cannot be simulated and (once approval is real) should hard-escalate.
- **C4.** `manifest-validate.ts` `intrusion` regex matches substrings:
  `sideEffects: ['imports payload from vendor']` fails registration for the
  word "payload". Over-broad; use a token/verb match.
- **C5.** `broker.ts` mint TTL is a fixed 120 000 ms regardless of
  `action.timeoutMs`; a long HIGH action can outlive its credential handle.
- **C6.** `AdapterHost.run` rejects `worker+container` with a thrown string;
  the Executor has no branch for it, so a `worker+container` capability would
  crash the invocation rather than degrade.
- **C7.** `contracts` `LEGAL_INVOCATION_TRANSITIONS` allows
  `POLICY_CHECKED → APPROVED` directly (no `AWAITING_APPROVAL`), which is what
  lets F-AG-2's auto-approve pass the lifecycle guard. The transition table
  should require `AWAITING_APPROVAL` whenever policy returned REQUIRE_APPROVAL.
- **C8.** `kernel.ts` `guardInputs` hard-codes `activeObjectiveCount: 0`; the
  mode machine can never see an active objective, so `FOCUSED`/objective-gated
  transitions are dead.

---

## 11. Required corrections — the ADR set

| ADR | Title | Closes |
|---|---|---|
| **0031** | Agency Plane must be wired and load-bearing before it is a control; documentation honesty | F-AG-1, F-AG-5, F-AG-9, F-AG-11, F-AG-12, F-SEC-1, F-PROC-1, F-PROC-3, F-EXP-1 |
| **0032** | Executor-run verification and simulation-gate; verified rollback | F-AG-3, F-AG-4, F-RES-3 |
| **0033** | Durable invocation lifecycle, distributed resource lease, saga recovery, idempotency | F-AG-6, F-AG-7, F-AG-10, F-RES-2, F-RES-3, F-DATA-4 |
| **0034** | Approval and dual-control enforcement; fail-closed; operator-act semantics | F-AG-2, F-AG-7 (barrier tx), F-AG-9 (operator act), C7 |
| **0035** | Credential Broker hardening: fail-closed material, out-of-process handle redemption, token-gated mint, real secret storage | F-AG-8, F-SEC-3 |
| **0036** | Observability contract: mandatory spans/metrics on the pipeline; `traceId` correlation; or retract the "complete OTel" claim | F-OBS-1, F-OBS-2, F-OBS-3, F-PROC-2 |
| **0037** | Node Protocol v1 implementation: identity, enrollment, key rotation, revocation, attestation, trust-tier store; backup/restore | F-SEC-2, F-DIST-1, F-DIST-2, F-DATA-1 |
| **0038** | Architecture-fitness gates and contract-compatibility tests (real, not grep) | F-AG-13, F-TEST-1, F-TEST-2, F-TEST-3, F-TEST-4 |

The full implementation direction for Codex (Stage B) is in
[`HARDENING_SPEC_MK42.md`](HARDENING_SPEC_MK42.md).

---

## 12. Score rationale

- **Architecture compliance (design) 9/10.** The constitution is genuinely
  excellent: law-anchored, self-reviewed, honest about non-goals, with
  extraction seams and a frozen Kernel. −1 for the design/tree drift (F-PROC-3)
  and for a threat model written in the present tense about unbuilt controls.
- **Architecture compliance (as-built) 4/10.** Spine matches ratified design
  (+4). Agency plane, cognition, objectives, nodes: absent as running code.
- **Security (as-built) 3/10.** The policy *library* and the spine's write path
  are sound (+3). Every agency-layer control is unwired, stubbed, or hollow;
  the broker fabricates secrets; approval is inverted. The gap between claimed
  and actual security posture is itself a risk.
- **Resilience (as-built) 5/10.** Spine degrades correctly and recovers from
  events (+5). No agency durability, no circuit breakers, no chaos coverage,
  cold-start unmeasured.
- **Observability (as-built) 2/10.** The plumbing (`withSpan`, `traceId`
  field, collector container) is in place (+2). Nothing emits.
- **Distributed readiness 2/10.** Contracts carry message boundaries (+2). No
  Node Protocol, no node identity, no second process on any boundary.
- **Test integrity 4/10.** 100 green tests, fast, deterministic (+4). Zero
  cover the Executor; security tests test helpers; fitness is a grep; no
  contract-version tests.

---

## 13. What MK.42 should deliberately NOT build during ASCENSION

- No new capability adapters. Eight manifests already outrun the pipeline.
- No FORGE / LABS polish. Self-extension on top of an unwired Executor is
  building a second floor before the first has joists.
- No Cognition Orchestrator, no Model Gateway provider adapters, no Agent
  Runtime *breadth* — but a **minimal** synthetic proposal ingress and a
  **single** leased agent-actor minter are needed to make the Executor
  testable (ADR-0031).
- No LiveKit / RTC infrastructure. RTC is on the ASCENSION trace diagram, but a
  single-box LAN does not need an SFU; define the seam and the degradation
  behaviour, don't deploy it.
- No multi-user. `principalId` scoping is already present; leave it.
- No HSM/TPM. Keychain + `0600` file is the MK.42 non-goal; just *build* that
  much (F-SEC-3).
- No premature service extraction. The monolith is correct for two nodes.

The purpose of ASCENSION is to make the foundation **true** — every documented
control enforced by running, tested code, or explicitly marked as not-yet — so
that MK.43 onward is built on load-bearing ground rather than on prose.
