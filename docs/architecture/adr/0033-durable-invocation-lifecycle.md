# ADR-0033: The invocation lifecycle, resource lease, and grant store are PostgreSQL-backed; saga recovery runs on cold start; proposals are idempotent

Status: Accepted
Date: 2026-09-03
Deciders: External Principal Architect (ASCENSION Stage A audit), Principal (rhyslacy123)
Relates-to: ADR-0025 (§1 lifecycle projection), ADR-0027 (freshness barrier), ADR-0009 (event sourcing scope), STATE_MODEL §5, §7

## Context

ADR-0025 §1 makes the Executor own `agency.invocations` "a projection folded
from the `jarvis.capability.*` event stream ... restart-recoverable". ADR-0027
puts the freshness re-read, the `resourceKey` lease (`FOR UPDATE`), and the
`capability.started` append in **one transaction**. Migration `0008_agency.sql`
creates all of it.

As built (`AUDIT_MK42_ASCENSION.md` F-AG-6, F-AG-7, F-AG-10, F-RES-2):

- `InvocationStore` is `new Map()`. `ResourceLeaseManager` is `new Map()`.
  `MemoryGrantStore` is `new Map()`. None of the `agency.*` tables are read or
  written.
- The freshness check, lease acquire, and started transition are three separate
  awaits with no transaction.
- The lease key is `capabilityId + ':' + JSON.stringify(input)`, ignoring the
  manifest `resourceKeySelector`.
- `invoke()` mints a fresh `randomUUID()` per call; a retried proposal executes
  twice. `idempotencyKeySelector` unused.
- Executor events go through a bespoke `ExecutorEventSink`, not `EventManager`,
  so they are not real envelopes and T21's `source` validation has nothing to
  check.

Restart therefore loses every in-flight invocation, saga compensation never
runs (`FAILURE_MODEL.md` §Kernel restarts, L23, T28), and the lease provides no
mutual exclusion across processes or nodes.

## Decision

### 1. `agency.invocations` is an event-sourced projection, written only by the Executor

- Every lifecycle transition is a real `Event` emitted through the Kernel
  `EventManager` (full envelope: `correlationId`, `causationId`, `provenance`,
  `principalId`, `privacyClass`, `subject: { kind: 'invocation', id }`),
  `AUDIT` class (`SECURITY` for `DENIED`/`ABORTED`/`VERIFICATION_FAILED`/
  credential mints/GUARDIAN steps), `source.component: 'capability-executor'`.
- A single projector folds `jarvis.agency.invocation.*` into
  `agency.invocations` + `agency.invocation_steps`. One writer (the projector),
  per STATE_MODEL §3. The in-memory `InvocationStore` becomes a read-through
  cache of that projection, not the source of truth.
- The Event Manager rejects a `jarvis.agency.invocation.*` event whose
  `source.component` is not the Executor's id (T21 enforcement surface).

### 2. The freshness barrier is one transaction

The Executor opens **one PG transaction** that:

1. `SELECT version, revoked_at, expires_at FROM agency.grants WHERE id = $grantId FOR SHARE`;
   drift ⇒ append `jarvis.agency.invocation.aborted`, write the row `ABORTED`,
   commit, stop — **no mint**;
2. `INSERT ... ON CONFLICT DO NOTHING` into `agency.resource_leases`
   (`resource_key` PK) `FOR UPDATE`; contention ⇒ queue or reject per the
   manifest's `resourceContention` policy;
3. append `jarvis.agency.invocation.started` and write the `EXECUTING` row;
4. commit.

Credential minting (ADR-0035) happens **after** this commit, against the now-
durable `EXECUTING` row.

### 3. The lease key comes from the manifest

`resource_key = applySelector(manifest.resourceKeySelector, invocation.input)`
— a declared JSON-path / template that extracts the true resource identity
(repo, absolute normalised path, container name, branch ref). Absent selector
⇒ the lease key is `capabilityId + ':' + action` (coarse but correct). Never
`JSON.stringify(input)`.

### 4. Idempotency

- The proposal carries a `proposalId` (client-generated ULID). The Executor
  keeps `agency.proposal_dedupe (proposal_id PK, invocation_id, first_seen)`;
  a repeat `proposalId` returns the existing invocation's current state, never
  a second execution.
- `idempotencyKey = applySelector(manifest.idempotencyKeySelector, input)` is
  passed to the adapter and, for `idempotent: false` actions, the Executor
  guarantees at-most-once attempt and never auto-retries (`EVENT_ARCHITECTURE.md`
  §5).
- `input_hash` uses a **canonical** serialization (sorted keys) — replaces
  `JSON.stringify` in `executor.ts` and `state-manager.ts` (F-DATA-4).

### 5. Cold-start saga recovery

On Kernel start, after projections rebuild (`KERNEL_CONSTITUTION.md` §5 step 2),
the Executor:

1. queries `agency.invocations` for rows in `EXECUTING` / `SIMULATING` /
   `ROLLING_BACK` / `COMPENSATING` with no terminal event;
2. for each: if `steps[]`, run `compensate` for completed steps in reverse
   (verified per ADR-0032 §3); else if `reversible`, run verified rollback;
   else mark `VERIFICATION_FAILED` + `SECURITY` alert;
3. emits `jarvis.agency.invocation.compensated` / terminal events;
4. releases orphaned `agency.resource_leases` rows (lease TTL also expires them
   independently).

### 6. Lease and token TTLs are bounded by the action timeout

`resource_leases.expires_at = now() + max(action.timeoutMs, minLeaseMs)`;
credential handle TTL ≥ lease TTL (fixes C5). A long action renews the lease at
each verified step or aborts.

### 7. Distributed readiness

The lease is a PG row, so mutual exclusion holds across multiple Kernel
instances and across Adapter Host nodes. When the Kernel is later split
(`SYSTEM_BOUNDARIES.md` §10), the Executor service keeps the `agency` schema;
no consumer change.

## Alternatives considered

- **Keep the in-memory stores; add a periodic snapshot to PG.** Rejected — a
  crash between snapshots loses invocations and leaves leases; the freshness
  barrier still isn't transactional.
- **Redis lease (as the docs originally said) instead of a PG row.** Rejected
  for MK.42 — the freshness re-read is already a PG transaction; putting the
  lease in the same transaction is simpler and stronger than a cross-store
  Redis lock. Redis remains fine for the *revocable long-action lease*
  heartbeat.
- **Fold the lifecycle on demand from events, no projection table.** ADR-0025
  already rejected this (restart recovery, in-flight listing, race detection
  need the table).

## Benefits

- Restart is safe: in-flight actions are compensated, not lost.
- The revocation TOCTOU is closed (one transaction).
- A retried proposal is a no-op.
- Mutual exclusion is process- and node-safe.

## Disadvantages

- Every transition is now a PG write + a real event (more IO than a `Map.set`).
  Acceptable at human-scale invocation rates (STATE_MODEL §6).
- A projector must be written and tested; the Executor's happy path gets a
  transaction boundary it did not have.

## Risks

- **Projector lag makes `agency.invocations` stale for an operator's "list
  in-flight" view.** Mitigated: the Executor keeps a write-through in-memory
  cache for its own decisions; the read API exposes `asOfEventPosition`.
- **The `resourceKeySelector` extracts the wrong identity, so two real
  conflicts get different keys.** Mitigated: SDK testkit requires a lease-key
  test per side-effecting action; the coarse fallback errs toward
  over-exclusion.

## Consequences

- `apps/core/src/kernel/executor/`: `InvocationStore`, `lease.ts`,
  `permission/grant-store.ts` gain PG-backed implementations; a new
  `invocation-projector.ts`; `saga.ts` is wired into cold start and the
  verify-fail path.
- New table `agency.proposal_dedupe` (migration `0009_agency_durability.sql` —
  note the `0007` gap in the sequence, deliberately left; the runner is
  filename-ordered and gap-tolerant).
- `EventManager`: rejects `jarvis.agency.invocation.*` from a non-Executor
  `source.component`.
- `executor.ts`: the bespoke `ExecutorEventSink` is replaced by `EventManager`;
  transitions wrap steps 1–4 above in one `tx.begin`.
- `AGENCY_MODEL.md` §4, `STATE_MODEL.md` §5, `FAILURE_MODEL.md` §Kernel
  restarts updated to as-built.

## Reversal difficulty

**High.** The event-sourced projection and the one-transaction barrier are the
enforcement of L23/L31 and ADR-0027. Going back to in-memory would reintroduce
the F-AG-6/F-AG-7 holes.

## Implementation note — 2026-09-04

Migration `0010_durable_agency_lifecycle.sql` makes the database enforce legal
state transitions and PROPOSED-only creation. Invocation identity, proposal,
policy/permission decisions, attempts, trace lineage, verification, recovery,
rollback, and outcome metadata are durable. Execution lease acquisition locks
the invocation and grant in one transaction, checks grant freshness, assigns a
unique lease owner/id, and advances to `LEASE_ACQUIRED`; heartbeat and
expired-only takeover are database operations. Cold start classifies an
expired in-flight effect as `UNVERIFIED` or `ROLLBACK_PENDING` and never
re-executes it. Redis is not involved in these decisions.

The former consequence text describing an in-memory write-through cache and a
separate `proposal_dedupe` table is superseded: production reads PostgreSQL
directly and proposal uniqueness is a partial unique index on
`agency.invocations.proposal_id`.
