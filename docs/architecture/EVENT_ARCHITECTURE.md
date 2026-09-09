# Event Architecture

Everything meaningful is an event (L4). This document defines the envelope,
naming, transport, durability, ordering, idempotency, correlation, replay, and
retention.

Subordinate to [`PRINCIPLES.md`](PRINCIPLES.md),
[`STATE_MODEL.md`](STATE_MODEL.md).

---

## 1. Roles of the two systems

| | PostgreSQL `events` | NATS JetStream |
|---|---|---|
| Role | **Durable ledger** — system of record for history | **Transport & distribution** — fan-out, replay buffer, backpressure |
| Guarantee | Durable, ordered per subject, append-only | At-least-once delivery, per-subject ordering within a stream, bounded retention |
| Authority | Yes | No — a cache of recent history for consumers |
| If it is down | Kernel cannot record → **fail closed** on state changes; reads still serve | Kernel keeps recording to PostgreSQL + local outbox; **distribution pauses**, resumes on recovery |

The Kernel writes PostgreSQL **first** (in the same transaction as the state
change), then an **outbox relay** publishes to JetStream. Consumers never
assume JetStream has an event PostgreSQL does not.

## 2. The Event envelope

Canonical contract: `packages/contracts/src/event.ts`.

```
Event<TPayload> {
  id             string   // ULID, globally unique, time-sortable
  type           string   // "jarvis.<plane>.<domain>.<name>", see §3
  schemaVersion  number    // payload schema version for `type`
  retentionClass "TRANSIENT" | "OPERATIONAL" | "AUDIT" | "MEMORY_CANDIDATE"
               | "SECURITY" | "DIAGNOSTIC"        // storage policy (§2.1, ADR-0009 Amendment 1)
  time           string   // RFC3339 UTC, when it occurred
  recordedAt     string   // RFC3339 UTC, when the Kernel persisted it
  source: {
    node         string   // node id that produced it
    component    string   // component/adapter/agent id
  }
  subject: {
    kind         string   // e.g. "objective", "grant", "entity", "session"
    id           string   // the aggregate id this event is ordered within
  }
  actor: {
    kind         "principal" | "agent" | "system" | "node"
    id           string
    onBehalfOf?  string   // principalId when kind = "agent"
  }
  provenance     Provenance          // see contracts/provenance.ts
  causationId    string   // id of the event or command that directly caused this
  correlationId  string   // stable id for the whole interaction (§6)
  principalId    string   // scoping key (L34); constant in MK.42
  privacyClass   "PUBLIC" | "INTERNAL" | "SENSITIVE" | "RESTRICTED"   // required
  traceId?       string   // OTel trace id (promoted from meta in ADR-0009 Amendment 1)
  location?      { spaceId: string; ref?: string }   // where it occurred, if meaningful
  confidence?    number   // 0..1, for events that carry an estimate
  evidence?      string[] // supporting event ids / source refs
  expiresAt?     string   // RFC3339 UTC; hint for retention beyond the class default
  payload        TPayload // schema-versioned, type-specific
  meta?          Record<string, string>  // non-authoritative hints
}
```

Rules:

- `id` is a **ULID**. Time-sortable, so a per-subject stream sorts correctly
  without a separate sequence.
- `type` is lower-case, dot-delimited, stable. Renaming a type is a breaking
  change requiring a new type + a translating consumer.
- `schemaVersion` bumps on any payload change. Consumers handle known versions
  and quarantine unknown-higher ones (`cognition`/`ingestion` never crash on a
  future version).
- `causationId` vs `correlationId`: causation is the *direct parent*;
  correlation is the *whole tree*. Given a `correlationId` you can reconstruct
  the entire interaction; given `causationId` chains you can reconstruct the
  exact path.
- `provenance` is mandatory on every event, as it is on every fact (L11).
- `privacyClass` is mandatory. It drives Context Compiler privacy filtering and
  cross-node propagation rules. `RESTRICTED` events never leave the node that
  produced them without an explicit HIGH-risk capability.
- `retentionClass` is mandatory and fixes the storage policy at append time
  (§2.1). It cannot be changed after append; to keep a `TRANSIENT` signal,
  a consumer **re-emits** a new elevated event.

## 3. Subject naming

`jarvis.<plane>.<domain>.<name>`

| Segment | Values |
|---|---|
| plane | `kernel`, `experience`, `perception`, `cognition`, `agency`, `world`, `data`, `infra` |
| domain | plane-specific: e.g. `kernel.objective`, `kernel.grant`, `perception.asr`, `agency.capability`, `world.fact`, `cognition.model` |
| name | past-tense verb or state: `created`, `updated`, `status_changed`, `decided`, `started`, `verified`, `failed`, `transcript`, `person.present` |

Examples:

```
jarvis.kernel.objective.created
jarvis.kernel.objective.status_changed
jarvis.kernel.grant.issued
jarvis.kernel.grant.revoked
jarvis.kernel.policy.decided
jarvis.agency.capability.started
jarvis.agency.capability.verified
jarvis.agency.capability.verification_failed
jarvis.agency.capability.rolled_back
jarvis.cognition.model.called
jarvis.cognition.proposal.emitted
jarvis.cognition.output_rejected
jarvis.perception.asr.transcript                (retentionClass: TRANSIENT)
jarvis.perception.vision.person.present         (retentionClass: TRANSIENT)
jarvis.perception.cursor.dwell                  (retentionClass: TRANSIENT)
jarvis.kernel.mode.changed                      (retentionClass: OPERATIONAL / SECURITY for GUARDIAN)
jarvis.kernel.session.started                   (retentionClass: OPERATIONAL)
jarvis.kernel.state.mutated                     (retentionClass: OPERATIONAL)
jarvis.kernel.identity.authenticated            (retentionClass: SECURITY)
jarvis.kernel.health.transitioned               (retentionClass: OPERATIONAL)
jarvis.kernel.notification.raised               (retentionClass: OPERATIONAL)
jarvis.kernel.context.compiled                  (retentionClass: DIAGNOSTIC)
jarvis.world.fact.asserted
jarvis.world.fact.superseded
jarvis.world.conflict.recorded
jarvis.infra.node.registered
jarvis.infra.node.heartbeat_missed
```

### JetStream stream layout

Streams are grouped by **transport lifetime**, which correlates with (but is
not identical to) `retentionClass`. PostgreSQL `events` is the durable archive;
JetStream is a bounded fan-out + short replay buffer.

| Stream | Subjects | JS retention | Backs retentionClass |
|---|---|---|---|
| `EPHEMERAL` | exact canonical `jarvis.perception.*` event subjects | minutes / size cap | high-frequency perception |
| `SECURE` | exact canonical identity, policy, permission, agency capability lifecycle, and `jarvis.security.*` event subjects | ~30 d | security-isolated subjects |
| `OPERATIONS` | every other exact canonical event subject | ~30 d | normal persistent operations |

The lists are generated from `EventNames` by `streamForEventType`. They contain
exact subjects rather than an overlapping `jarvis.>` catch-all. Startup fails
before stream creation if a canonical name is missing or has more than one
owner. Consumer filters select from the already non-overlapping ownership; they
are not used as a conflict-resolution mechanism.

Consumers are **durable pull consumers** with explicit ack, max-deliver, and a
dead-letter subject.

## 4. Ordering

- **Per subject**: strict. Events with the same `subject.id` are delivered and
  applied in `id` (ULID/time) order. Projectors and ingestion rely only on
  this.
- **Across subjects**: no guarantee. Cross-aggregate consistency is achieved
  with sagas/process managers (a component reacts to event A on subject X by
  issuing a command that produces event B on subject Y), never by assuming
  global order.

## 5. Idempotency

- Every consumer keys processing on `Event.id` and keeps a processed-set (or a
  monotonic per-subject checkpoint). Re-delivery is a no-op.
- Commands carry a client-generated `commandId`; the Kernel dedupes so a
  retried command does not double-apply.
- Capability adapters must be idempotent per `invocationId` or declare
  `idempotent: false`, in which case the Executor guarantees at-most-once
  attempt semantics and never auto-retries.

## 6. Correlation

- The **ingress component** that first accepts an interaction mints
  `correlationId` (review §16.2):
  - Session Manager — for Experience-Plane commands/proposals.
  - Perception ingress (Context Compiler's intake) — for
    observation-triggered flows.
  - Scheduler — for timed/triggered flows.
  - Objective Engine — for objective-initiated flows.
- Every downstream event/command copies `correlationId` unchanged and sets
  `causationId` to its direct parent.
- Diagnostics and Audit reconstruct an interaction by `correlationId`; the OTel
  trace id is carried in the top-level `traceId` field (ADR-0009 Amendment 1)
  for cross-referencing with distributed traces.

## 7. Replay

- **Projection rebuild**: replay `events` for a read model's subjects from a
  checkpoint. Standard operation (`STATE_MODEL.md` §3).
- **Consumer catch-up**: a restarted consumer resumes its durable JetStream
  consumer; if it fell outside the JS retention window, it backfills from
  PostgreSQL `events` (the authority) then rejoins the live stream.
- **Time-travel debugging**: diagnostics can replay a `correlationId`'s event
  tree into an isolated sandbox projector set. Never against production read
  models.
- Replayed events are tagged `meta.replay=true` so side-effecting consumers can
  refuse them. **Replay ≠ re-execution**: the replay engine feeds events only to
  *pure projectors* and read-model rebuilders. Any consumer that causes an
  effect (Executor, Notification delivery, outbound adapters) rejects events
  carrying `meta.replay=true`. This separation is enforced structurally: the
  replay path uses a dedicated `ReplayBus` that only projector consumers may
  subscribe to.

## 8. Retention (summary; full rules in `STATE_MODEL.md` §2.1 and ADR-0009 Amendment 1)

| retentionClass | PostgreSQL `events` | JetStream | Notes |
|---|---|---|---|
| `TRANSIENT` | **not persisted** | `EPHEMERAL`, minutes | optional in-memory ring buffer only |
| `OPERATIONAL` | 90 d, then archived partition | `OPERATIONS`, ~30 d | state changes, sessions, modes, health |
| `AUDIT` | indefinite, tamper-evident partition | type-routed stream, ~30 d | policy, grants, executions |
| `MEMORY_CANDIDATE` | until consolidated or 30 d | `OPERATIONS` | a future Memory service promotes these |
| `SECURITY` | indefinite, tamper-evident partition | type-routed stream | auth, denials, GUARDIAN, anomalies |
| `DIAGNOSTIC` | 14 d | `OPERATIONS` | context.compiled, scheduler ticks |

Anything `TRANSIENT` that must outlive its window is **re-emitted** by a
consumer as an elevated event (`MEMORY_CANDIDATE` / `OPERATIONAL`) whose
`evidence` points at the original (soon-gone) event id.

## 9. Schema governance

- Payload schemas live in `packages/contracts` as typed definitions + runtime
  validators (the Validator uses them).
- Adding an optional field: `schemaVersion` bump, backward compatible.
- Removing/retyping a field: new `type` or major `schemaVersion`; a translation
  consumer bridges old→new during migration.
- The Event Manager rejects an event whose payload fails its `type` +
  `schemaVersion` validator at append time — malformed events never enter the
  ledger.
