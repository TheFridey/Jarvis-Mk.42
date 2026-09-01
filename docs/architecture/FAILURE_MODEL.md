# Failure Model

The architecture must degrade, not collapse (L39). This document specifies
behaviour for every named failure.

Subordinate to [`PRINCIPLES.md`](PRINCIPLES.md).

---

## 1. Failure domains

| Domain | Contains a failure of | Isolated by |
|---|---|---|
| Workstation | shell, voice, vision, `windows` adapter | Separate node; Kernel runs without it |
| Perception process | one sensor stream | Separate OS process per stream; others continue |
| Model Gateway | all cloud inference | Separate process; timed + circuit-broken calls |
| Capability adapter | one class of effect | Out-of-process per invocation; lease-bounded |
| Agent | one cognitive job | Isolated worker; lease outcome recorded |
| Node | one attached device | Node Protocol heartbeat; scoped subscriptions |
| Data store (PG / Redis / NATS) | one data concern | Distinct roles; Kernel has a local durable queue |
| Kernel | the spine | Event-sourced recovery; fail-closed on writes |

## 2. Dependency failure ladder

### Cloud AI offline / all providers down
- Gateway returns `finishReason: error` after circuit-break.
- Cognition: route to local model (`locality`), else bounded retry, else defer
  + inform principal, else answer from World Model / Memory with templated
  phrasing.
- **Unaffected**: perception, presence, event recording, state reads,
  deterministic policy, already-approved local capabilities, audit, objectives.
- JARVIS remains *itself*; only heavy reasoning is reduced.

### Internet offline
- As above, plus external capabilities (`github`, `web`, external `comms`)
  return `capability.denied` with reason `network_unavailable`; the Executor
  queues retriable ones and notifies.
- Local capabilities (`filesystem`, `terminal`, `docker`, `windows`) normal.

### PostgreSQL offline
- **State changes fail closed.** The Kernel refuses to accept commands that
  would write authoritative state; it emits `kernel.degraded: no-authority` and
  buffers inbound commands in a bounded local queue (with backpressure /
  rejection when full).
- **Reads**: served from Redis caches and in-memory Projected State snapshots
  where present; stale-marked. Queries with no cache ⇒ `unavailable`.
- Perception keeps emitting to NATS; those signal events buffer in JetStream
  and are ingested when PG returns.
- On recovery: replay buffered commands through validation (dropping ones whose
  preconditions no longer hold), resume projectors, clear degraded state.

### Redis offline
- Ephemeral state lost. **No authoritative data lost** (`DATA_OWNERSHIP.md`
  §2).
- Rebuild: session liveness from live socket reconnections; node liveness from
  re-registration/heartbeat; presence recomputed; leases/locks re-acquired
  (in-flight lease holders detect loss and pause at next checkpoint);
  rate-limit counters reset (fail-safe: brief over-permissiveness on limits is
  accepted, or switch to conservative in-memory limits).
- Authority tokens: existing ones invalid (they lived in Redis) ⇒ callers
  re-acquire; issuance records remain in `events`.
- Latency rises (more PG reads) until warm.

### NATS offline
- **Kernel keeps writing PostgreSQL** (events + outbox rows). Distribution
  pauses.
- Consumers (projectors, World Model ingestion, Notification, Audit) stop
  receiving; projectors can also catch up directly from `events` (the
  authority) — the Kernel does this after a short NATS outage rather than
  waiting.
- Perception spools to bounded local buffers; drops oldest signal on overflow;
  emits a gap marker on reconnect.
- On recovery: outbox relay resumes from the last dispatched row; consumers
  catch up via durable consumers or PG backfill.

### GPU unavailable
- Local perception models fall back to lighter models / CPU; if impossible,
  that stream emits `.unavailable` and others continue.
- Local inference models (`locality: local`) become unavailable ⇒ gateway
  treats `local` requests as errored (cognition degrades), `prefer-local`
  falls back to cloud.

## 3. Component / device failures

### Webcam or microphone disappears
- `jarvis.perception.<stream>.lost` emitted; stream stops cleanly.
- Presence and cognition adapt (other modalities; more clarifying questions).
- Reappearance ⇒ `.restored`; stream resumes.
- No crash of the workstation shell or the Kernel.

### Model produces malformed output
- Validator rejects ⇒ `jarvis.cognition.output_rejected` ⇒ stricter retry ⇒
  simpler model ⇒ ask principal. Bounded attempts; never a crash; never a
  silent pass into the system.

### Agent crashes
- Agent Runtime detects lease breach (heartbeat/timeout); records
  `agent.run.failed` with partial output (validated if usable); frees the
  workspace; the initiating cognition/objective decides to retry, re-plan, or
  surface.
- No system state lost (agents own none, L10).

### Node disappears
- Missed heartbeats ⇒ `jarvis.infra.node.heartbeat_missed` then
  `node.unavailable`; its subscriptions dropped; its capability adapters marked
  unavailable; presence updated.
- In-flight capability invocations hosted there: the Executor's terminal-event
  timeout fires ⇒ treated as `verification_failed` ⇒ rollback if reversible,
  else CRITICAL alert.
- Node returns ⇒ re-registers via Node Protocol; operator re-confirms tier if
  it was `guest`/`owned-mobile`.

### Capability fails
- `verify` fails ⇒ rollback (reversible) or `verification_failed` alert
  (irreversible) ⇒ Health + Notification + Audit.
- Adapter process crash ⇒ Executor sees no result within wall-time ⇒ same path.

### Capability partially executes (multi-step)
- Steps have per-step `verify` + `compensate`.
- Crash mid-action detected on restart (`capability.started` with no terminal
  event) ⇒ Executor runs `compensate` for completed steps in reverse
  (saga) ⇒ `capability.compensated`.
- Non-idempotent, non-compensatable steps ⇒ manifest must declare the action
  CRITICAL and simulate-first; the operator owns the risk explicitly.

### Desktop (workstation shell) crashes
- Kernel and local server unaffected. Objectives, scheduled work, perception
  from other nodes, and already-running capabilities continue.
- On shell restart: it reconnects, re-subscribes, re-renders from Projected
  State. Any unsent input drafts held only in the shell are lost (acceptable;
  they were never authoritative).

### Kernel Core restarts
- Cold start per `STATE_MODEL.md` §7 / `KERNEL_CONSTITUTION.md` §5: replay
  events → rebuild Projected State → discard + rebuild Ephemeral → resume
  outbox → compensate orphaned executions → open ingress.
- The core decision loop is available before NATS/gateway reconnect.
- Target < 10 s for MK.42 volumes. In-flight interactions are resumed by
  `correlationId` where the client reconnects; otherwise they end cleanly with
  a recorded outcome.

## 4. Approval path failures

- Operator unreachable during REQUIRE_APPROVAL ⇒ **fail closed**: queued, not
  executed, unless a standing grant carries
  `mayProceedWithoutLiveApproval` for that scope (`SECURITY_MODEL.md` §7).
- Approval surface (diagnostics/shell) down ⇒ Notification Manager escalates to
  any other trusted surface; still fail-closed until answered.

## 5. Cascading-failure guards

- Every external call (provider, adapter, node) is **timed + circuit-broken**;
  a slow dependency cannot stall the Kernel loop.
- Bounded queues everywhere (command intake, perception spool, outbox); defined
  overflow behaviour (reject with backpressure, drop-oldest-signal) — never
  unbounded memory growth.
- Health Manager degradation state gates behaviour: in `degraded` it raises
  approval requirements, disables non-essential scheduled work, and prefers
  local routing.
- No component blocks its main loop on another component's synchronous
  response without a timeout + fallback.

## 6. What must never happen on any failure

- Authoritative state corruption or silent loss.
- An effect executed without passing the full Executor pipeline.
- An approval defaulting to ALLOW.
- An untrusted output entering the system unvalidated.
- The Kernel halting because a *replaceable resource* (cloud, a provider, a
  sensor, a node) is gone.
