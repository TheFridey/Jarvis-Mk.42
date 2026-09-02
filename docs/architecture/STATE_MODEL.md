# State Model

How state works in JARVIS: the five stores, what "one authoritative logical
system state" (L5) actually means, the scope of event sourcing, race
prevention, compaction, and cold start.

Subordinate to [`PRINCIPLES.md`](PRINCIPLES.md),
[`DATA_OWNERSHIP.md`](DATA_OWNERSHIP.md).

---

## 1. The five stores

| Store | Question | Authority | Technology | Mutability |
|---|---|---|---|---|
| **Event Log** | What has happened? | Source of truth for **history** | PG `events` | Append-only, never rewritten |
| **Projected State** | What are the current values? | Source of truth for **current authoritative values** | PG `projections.*` | Overwritten by projectors only |
| **Ephemeral Runtime State** | What is happening right now, operationally? | Not authoritative; reconstructible | Redis + in-memory | Free |
| **World Model** | What is true about the world, and why? | Source of truth for **beliefs** (with provenance) | PG `world_model.*` | Belief revision; archive, don't delete |
| **Memory** | What experience is relevant to now? — see [`MNEMOSYNE_MODEL.md`](MNEMOSYNE_MODEL.md) | A cognitive resource, not truth | PG `memory.*` + pgvector | Append + summarise + decay |

"One authoritative logical system state" (L5) = **Event Log + Projected
State**. The World Model and Memory are separate systems (L8) that the Kernel
also owns but that answer different questions and carry different guarantees.
Ephemeral state is explicitly *not* part of the authoritative state — that is
the point of separating it.

## 2. Event Log

- One table, `events`, partitioned by **event class** then by time.
- Ordered per **subject** (the aggregate an event concerns). Global order is
  not guaranteed or needed; per-subject order is.
- Every row is the canonical `Event` envelope (`EVENT_ARCHITECTURE.md` §2).
- **Never** updated or deleted for ledger-class events. Signal-class events are
  dropped wholesale by partition when their retention window passes.
- Written **transactionally** with any Projected State change it causes, plus
  an outbox row, in one PostgreSQL transaction (the outbox pattern). The relay
  then publishes to NATS.

### 2.1 Retention classes

Per ADR-0009 **Amendment 1**, every event carries a `retentionClass` that fixes
its storage policy at append time:

| retentionClass | Examples | Persisted to `events`? | Retention |
|---|---|---|---|
| `TRANSIENT` | `perception.asr.transcript`, `perception.vision.*`, `perception.cursor.*`, raw pose/landmark/audio | **No** (bus only; optional in-memory ring buffer) | seconds–minutes |
| `OPERATIONAL` | `state.mutated`, `mode.changed`, `session.*`, `health.transitioned`, `notification.raised`, `node.registered` | Yes | 90 d, then archived partition |
| `AUDIT` | `policy.decided`, `grant.*`, `capability.*`, `objective.*` | Yes, tamper-evident partition | indefinite (cold-storage old partitions) |
| `MEMORY_CANDIDATE` | events a future Memory service may consolidate into episodes | Yes | until consolidated, else 30 d |
| `SECURITY` | `identity.authenticated`, `permission.denied`, `policy.denied`, GUARDIAN `mode.changed`, anomaly events | Yes, tamper-evident partition | indefinite |
| `DIAGNOSTIC` | `context.compiled`, `scheduler.tick`, internal-routine traces | Yes | 14 d |

Perception **debounces and aggregates** before emitting even `TRANSIENT` events
(review §16.11): "cursor dwelled on element X 3.2 s" not 190 move events. A
`TRANSIENT` signal that must persist is **re-emitted** by a consumer as an
elevated event (`MEMORY_CANDIDATE` / `OPERATIONAL`) whose `evidence` cites the
original.

`events` is `PARTITION BY LIST (retention_class)` then range-partitioned by
month within each class. `TRANSIENT` has no partition (never written).

## 3. Projected State

- Materialised read models under `projections.*`, one owner each
  (`DATA_OWNERSHIP.md` §1).
- Built by **projectors**: pure functions `(currentReadModel, event) →
  newReadModel`. Each read model has **exactly one projector** (single-writer,
  race-free by construction, review §16.10).
- Projectors are **idempotent** on `Event.id` and track a per-read-model
  checkpoint (last applied event position per subject).
- A read model can be **rebuilt from zero** by replaying its subjects. This is
  the recovery and schema-migration mechanism: to change a read model's shape,
  deploy the new projector, rebuild, cut over.

## 4. Event sourcing — scope (the deliberate choice)

Full event sourcing everywhere is **rejected** for MK.42 (review §16.4):
catalogue data does not benefit and pays a read-model tax.

| Data | Approach | Why |
|---|---|---|
| Objectives, permission grants, capability executions, policy decisions, audit | **Event-sourced.** The event stream is the truth; Projected State is a cache of the fold. | These need full history, replay, and "why did this happen" reconstruction. L15, L31. |
| Model registrations, capability manifests, node descriptors, policy rules | **CRUD with mandatory event emission.** The row is the truth; a `*.registered` / `*.updated` event is emitted in the same transaction. | Low churn, no value in folding; but every change is still on the ledger (L4) and auditable. |
| Sessions, presence, health, leases, rate limits | **Ephemeral**, not sourced. Transitions may emit events for audit/history but the current value lives in Redis. | Reconstructible from live connections; sourcing them is waste. |

**Every extraction seam for full event sourcing is preserved:** all mutations
already emit events, so a CRUD table can be promoted to event-sourced later by
adding a projector and treating the stream as canonical.

## 5. Race prevention

| Race | Prevention |
|---|---|
| Two projectors writing one read model | Forbidden by design: one projector per read model. |
| Grant revoked while a capability executes | **Freshness barrier**: the Executor reads the grant's current version in the same transaction that appends `capability.started`. Revoked-before ⇒ abort. Long actions hold a **revocable lease** re-checked at each verifiable step. |
| Concurrent objective status writes | Objective Engine serialises commands per objective id (per-id queue / advisory lock). |
| Concurrent capability invocations on the same resource | Executor acquires a Redis lease on a capability-declared `resourceKey` before execute; contention ⇒ queue or reject per manifest. |
| Outbox relay double-publish | Consumers idempotent on `Event.id`; relay marks outbox rows dispatched transactionally. |
| Projector lag making a read stale | Read APIs can return a `asOfEventPosition`; callers needing read-your-writes pass the position of their own command's event and the API waits (bounded) for the projector to reach it. |

## 6. Compaction & bounded persistence (L4 vs unbounded growth, review §16.11)

- **Signal events**: partition-dropped past the window. No compaction needed —
  they are disposable by design.
- **World Model facts**: when a fact's `validTo` passes or it is superseded, it
  moves to `facts_archive` (separate partition, out of the hot query path). The
  evidence graph is retained. A background job runs supersession + archival.
- **Memory** (MNEMOSYNE): retention, summarisation, and decay are defined in
  [`MNEMOSYNE_MODEL.md`](MNEMOSYNE_MODEL.md) §Forgetting. Never touches ledger
  events.
- **Projected State**: bounded by definition (current values, not history).
- **Audit**: retained indefinitely but partitioned by time; old partitions can
  be moved to cold storage while staying queryable.

Result: PostgreSQL growth is dominated by ledger + audit events at human-scale
rates (thousands/day, not millions), which is comfortably within a single
local-server PostgreSQL for many years.

## 7. Cold start & recovery

1. Connect PostgreSQL.
2. For each read model, load its checkpoint; replay `events` for its subjects
   from the checkpoint forward to rebuild Projected State.
3. Discard all Ephemeral State. Rebuild from: live surface reconnections
   (sessions), node re-registration (node liveness), Health probes.
4. Connect NATS; resume the outbox relay from the last dispatched row.
5. Detect orphaned executions: `capability.started` with no terminal event ⇒
   run declared compensation (`AGENCY_MODEL.md`).
6. Open ingress.

The **core decision loop** (accept command → policy → permission → record) is
available after step 2 even if NATS (4) or the gateway are down — degraded, not
halted (L39).

Target cold start for MK.42 data volumes: **< 10 s**.

## 8. Backup

- PostgreSQL: continuous WAL archiving + nightly base backup to object storage.
  This backs up **everything authoritative** (Event Log, Projected State, World
  Model, Memory metadata, Audit).
- Object storage: replicated bucket / periodic sync for blobs.
- Redis: **not backed up** — it holds nothing authoritative.
- Recovery = restore PostgreSQL + object storage, then cold start. Projected
  State is rebuilt from events, so a slightly stale projection backup is
  harmless.
