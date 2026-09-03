# ADR-0025: The Agency Plane — Executor-owned action lifecycle, Credential Broker, Adapter Host

Status: Accepted
Date: 2026-09-03
Deciders: Principal Security Architect (Claude), Principal (rhyslacy123)
Supersedes-in-part: ADR-0016 (this ADR is the as-designed expansion; ADR-0016's
manifest + single-Executor decision stands unchanged)

## Context

ADR-0016 froze the shape: a capability is a manifest + an out-of-process
adapter, and one Executor is the sole path to any effect. It did **not** settle:

- who owns the **action lifecycle** state machine (PROPOSED … ROLLED_BACK) —
  and whether that is the Executor, a new component, or nothing (folded on
  demand);
- how adapter **credentials** are held and handed out per invocation without a
  broad standing secret ever reaching adapter code;
- what the adapter **worker runtime** is — process model, environment, IPC
  surface, what it can and cannot reach.

The HEPHAESTUS phase (ROADMAP MK.44 + MK.50, collapsed) builds the whole
Agency Plane at once, so these must be decided now. The MIND spec
(`docs/superpowers/specs/2026-09-02-the-mind-cognitive-architecture-design.md`)
introduced a Cognition Orchestrator that *sequences* plan steps; the risk is
two overlapping state machines for one action.

## Decision

### 1. The Capability Executor owns the single action lifecycle

The Executor is a **Kernel-internal protected service** (Executor-class, like
Knowledge Ingestion — not a 17th frozen component; `KERNEL_CONSTITUTION.md` §1
already names it). It owns `agency.invocations`, a projection folded from the
`jarvis.capability.*` event stream, holding one authoritative lifecycle per
invocation:

```
PROPOSED → VALIDATED → POLICY_CHECKED
  → (AWAITING_APPROVAL → APPROVED)?          -- only if policy said REQUIRE_APPROVAL
  → (SIMULATING → SIMULATED)?               -- only if riskClass >= HIGH
  → EXECUTING → VERIFYING → COMPLETED

non-happy terminals:
  REJECTED               -- Validator
  DENIED                 -- Policy Engine
  ABORTED                -- freshness barrier (grant stale/revoked) or lease lost
  FAILED                 -- adapter execute threw / timed out, nothing to undo
  VERIFICATION_FAILED    -- verify failed, action irreversible  → alert
  ROLLING_BACK → ROLLED_BACK
  COMPENSATING → PARTIALLY_COMPLETED        -- multi-step saga, some steps compensated
```

Every transition emits an `AUDIT`-class ledger event (`SECURITY`-class for
`DENIED`, `ABORTED`, `VERIFICATION_FAILED`, and credential-broker mints). No
transition without an event. The `capability.started` event and the
`EXECUTING` row write happen in **one transaction** with the freshness-barrier
re-read of `grant.version`.

The Cognition Orchestrator, Objective Engine, Scheduler, and Experience
surfaces **propose**; they advance their own plan/objective state only by
observing a `capability.verified` (or terminal-failure) event they did **not**
emit. The Orchestrator's preview POLICY/RISK/PERMISSION pass is explicitly
advisory; the Executor re-derives and re-checks everything at dispatch.

### 2. Credential Broker

A new **Kernel-internal protected service**. It is the only process that holds
adapter credential **material** (loaded from the OS keychain / secrets file at
Kernel start). It never writes state and never appears on the effect path
except to mint.

Per authorised invocation the Executor calls
`broker.mint(invocationId, capabilityId, action, resourceRef, mode)` and
receives a **credential handle** scoped to exactly that invocation:

- **derived short-lived** where the backend supports it: GitHub fine-grained
  installation token (repo + permission scoped, ≤1 h), Docker via a
  command-allowlisted socket proxy, cloud via STS `AssumeRole`.
- **wrapped static** where it does not: the secret is injected into the worker
  process memory for the invocation lifetime only, behind a wrapper that
  enforces the resource allowlist, never logged, zeroized on worker exit.
- `mode: 'dry-run'` ⇒ the broker mints a **read-only / sandbox** credential, so
  a faked `simulate` has no real access.

Handles are single-use, bound to `invocationId`, and expire with the
invocation. Every mint emits `jarvis.security.credential.minted` (SECURITY,
input/secret **not** included — resource scope + TTL only).

### 3. Adapter Host

A new deployable, `apps/adapter-host`, running on each node where resources
live (the local server for `docker`/`github`/`web`; the workstation for
`windows`/`filesystem`/`terminal`/`browser`).

- Spawns **one Node worker process per invocation** for `riskClass >= MEDIUM`;
  a warm pool is permitted only for `AMBIENT`/`LOW` reads.
- The worker starts with **zero inherited environment** (no `process.env`
  secrets, no `PATH` beyond a fixed minimum), a working directory that is a
  fresh scratch dir, and a single typed IPC channel to the Executor.
- The worker receives: the validated `input`, the credential **handle** (not
  material, unless wrapped-static), and a structured logger. It cannot open a
  socket to NATS, the Kernel DB, or the broker; it cannot emit ledger events.
- `executionEnvironment: 'worker+container'` capabilities run the worker inside
  a fresh restricted container (the JARVIS LABS mechanism, ADR-0029) instead of
  a bare process.
- The Adapter Host holds no credential of its own beyond a node identity for
  the Executor channel (mTLS).

## Alternatives considered

- **A separate "Action Manager" Kernel component owns the lifecycle, Executor
  just runs adapters.** Expands the frozen 16 (needs a heavier ADR), and
  creates a lifecycle↔execution handoff that is a confused-deputy seam.
  Rejected — the Executor already holds the resource lease, the freshness
  barrier, and saga recovery; the lifecycle belongs with it.
- **No lifecycle projection; fold invocation state on demand.** Restart
  recovery, "list in-flight actions", race detection, and the freshness
  barrier all need the projection anyway. Rejected.
- **Adapters read their own secret from `process.env` / a mounted file
  (classic 12-factor).** A poisoned dependency in one adapter then exfiltrates
  a long-lived secret. Rejected — the broker + per-invocation handle bounds the
  blast radius of a compromised adapter to one invocation's scope.
- **Warm worker pool for everything (lower latency).** A pooled worker that
  handled a HIGH action and was compromised then serves the next principal's
  invocation. Rejected for `riskClass >= MEDIUM`; allowed for cheap reads.
- **Adapters as in-process modules for this phase, out-of-process "later".**
  Directly violates ADR-0016 and L18/L30; a compromised adapter would share
  Kernel memory. Rejected outright.

## Benefits

- One authoritative lifecycle per action; the Orchestrator cannot fork it.
- A compromised adapter holds, at most, one invocation's narrowly-scoped
  credential for that invocation's lifetime.
- Restart recovery is uniform: an `EXECUTING` row with no terminal event runs
  declared compensation (saga), exactly as Knowledge Ingestion / the
  Orchestrator recover.
- The audit trail is complete by construction — the row cannot advance without
  the event.

## Disadvantages

- Process spawn per MEDIUM+ invocation costs latency (tens of ms) and memory.
- The Credential Broker is a new privileged service to secure and test.
- `apps/adapter-host` is a new deployable with its own lifecycle on two nodes.

## Risks

- **Broker becomes a single point of secret compromise.** Mitigated: it holds
  material only in memory, never writes it, exposes only `mint`, runs as its
  own process with no inbound network except the Executor channel, and every
  mint is audited.
- **Worker escapes its scratch dir / minimal env.** Mitigated: OS-level
  working-dir confinement, no shell (`terminal` uses argv arrays only,
  ADR-0026), `executionEnvironment: 'worker+container'` for anything that runs
  foreign code.
- **Latency pressure tempts a "fast path" that skips a stage.** Mitigated:
  credential partitioning makes the Executor the only path that can obtain a
  credential handle at all; there is no adapter entry point that the broker
  will mint for outside an Executor-issued `invocationId`.

## Consequences

- `KERNEL_CONSTITUTION.md` §1 gains a note: the Credential Broker joins the
  Executor and Knowledge Ingestion as a named Kernel-internal protected
  service (not a frozen top-level component).
- New deployable `apps/adapter-host`; `apps/README.md` and
  `SYSTEM_BOUNDARIES.md` §1 updated.
- New contracts: `agency.ts` (lifecycle states, `InvocationLifecycle`,
  `CredentialHandle`, `AdapterContext`), extensions to `capability.ts`.
- New schema `agency` (migration): `capabilities`, `capability_versions`,
  `grants`, `approvals`, `policy_rules`, `invocations`, `invocation_steps`,
  `resource_leases`, `credential_grants` (audit of mints, no material).
- `AGENCY_MODEL.md` rewritten to the as-designed pipeline.

## Reversal difficulty

**High.** The lifecycle projection, the broker, and the worker model are
load-bearing for L18–L24, L28–L30. Field-level evolution is additive (Low); the
three structural decisions here cannot change cheaply once adapters depend on
them.
