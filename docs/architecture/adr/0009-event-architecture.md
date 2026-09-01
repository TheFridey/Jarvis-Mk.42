# ADR-0009: Event-sourced core, outbox relay, selective sourcing

Status: Accepted (amended 2026-08-31, see "Amendment 1")
Date: 2026-08-31
Deciders: Principal Architect

## Context
L4: every meaningful occurrence can be an event. L5: one authoritative state.
L15/L31: JARVIS must reconstruct *why* something happened and be auditable. We
need history, replay, and provenance without (a) making PostgreSQL and NATS
disagree, (b) paying an event-sourcing tax on low-value catalogue data, or (c)
letting the Event Log grow without bound (adversarial review §16.11).

## Decision
1. **Durable ledger in PostgreSQL** (`events` table), append-only, ordered per
   `subject`, partitioned by **event class** (`ledger` / `signal` / `derived`)
   then time.
2. **Transactional outbox**: a state change, its event, and an outbox row are
   written in one PostgreSQL transaction; a relay then publishes to NATS
   JetStream. Consumers never assume NATS has what PostgreSQL lacks.
3. **Selective event sourcing**: event-sourced for objectives, grants,
   capability executions, policy decisions, audit; CRUD-with-mandatory-event-
   emission for catalogues (models, capability manifests, node descriptors,
   policy rules); ephemeral (not sourced) for sessions/presence/health/leases.
4. **Retention by class**: ledger indefinite (cold-storage old partitions),
   signal on a rolling 7-day window (partition-drop), derived short TTL.
   Durable value from signals must be *promoted* to a World Model fact or
   Memory episode first.
5. **One projector per read model**, idempotent on `Event.id`, checkpointed,
   rebuildable from zero.

## Alternatives considered
- **Full event sourcing everywhere** — uniform, but catalogue data gains
  nothing and pays a read-model + rehydration cost; rejected (review §16.4).
- **No event sourcing, just CRUD + an audit log** — simpler, but loses replay,
  time-travel debugging, and cheap read-model migration; weakens L15.
- **CDC (Debezium) instead of an application outbox** — removes outbox code but
  adds Kafka Connect-class infra and couples event shape to table shape.
  Rejected for MK.42 footprint.
- **Keep all events forever** — violates bounded-persistence; signal volume
  (perception) would swamp PostgreSQL in weeks.

## Benefits
- PostgreSQL and NATS cannot diverge (outbox).
- Full provenance + replay for the data that needs it; no tax on the data that
  doesn't.
- Read-model schema changes are "deploy new projector, rebuild" — no
  migration of historical rows.
- Perception firehose is bounded by design.

## Disadvantages
- Outbox relay is code to write and operate.
- Two persistence styles (sourced vs CRUD) to understand — mitigated by a
  clear scope table (`STATE_MODEL.md` §4).
- Signal promotion logic must be correct or short-lived data is lost —
  mitigated by making promotion explicit and tested.

## Risks
- A projector bug corrupts a read model. Mitigated: rebuild from `events`; read
  models are disposable caches of the fold.
- Getting the sourced/CRUD split wrong. Mitigated: every CRUD mutation still
  emits an event, so promoting a table to sourced later is additive.

## Consequences
- Any state change that emits an event MUST use the outbox transaction.
- Signal-class events may not be relied on beyond their window; consumers
  promote what must persist.
- `EVENT_ARCHITECTURE.md` governs envelope, subjects, ordering, idempotency,
  replay, retention.

## Reversal difficulty
**High.** Event sourcing shapes the State Manager, every projector, recovery,
and audit. Moving fully off it means rebuilding current-state as the primary
store and re-deriving history some other way. Moving *further* onto it
(promoting CRUD tables) is Low. We can tune the split cheaply; we cannot cheaply
abandon the approach.

---

## Amendment 1 (2026-08-31) — retention taxonomy + envelope fields

The MK.43 implementation phase adopts a richer, more actionable retention
taxonomy than the original `ledger | signal | derived`, and extends the Event
envelope with fields the Nervous System requires. Both changes are **additive
or a strict refinement** — no consumer semantics are weakened.

### Retention classes (replaces `class`)

The envelope field `class` is renamed `retentionClass` and takes six values.
Each maps to a storage policy enforced by the Event Manager at append time:

| retentionClass | Enters append-only store? | Default TTL / retention | Replaces old value |
|---|---|---|---|
| `TRANSIENT` | no (bus only; optional short ring buffer) | seconds–minutes | ~ `signal` (high-frequency perception: hand landmarks, audio frames, raw cursor) |
| `OPERATIONAL` | yes | 90 days, then archive | ~ `ledger` (state changes, mode changes, sessions, health transitions) |
| `AUDIT` | yes, tamper-evident partition | indefinite (cold-storage old partitions) | ~ `ledger` (policy decisions, grants, capability executions) |
| `MEMORY_CANDIDATE` | yes | until consolidated or 30 days | new (events a future Memory service may promote to episodes) |
| `SECURITY` | yes, tamper-evident partition | indefinite | new (auth, GUARDIAN transitions, permission/policy denials, anomalies) |
| `DIAGNOSTIC` | yes | 14 days | ~ `derived` (context.compiled, scheduler ticks, internal routine traces) |

High-frequency perception is `TRANSIENT` and stays ephemeral unless a consumer
**deliberately re-emits** an elevated event (`MEMORY_CANDIDATE` / `OPERATIONAL`).
Partitioning: `events` is `PARTITION BY LIST (retention_class)` then range by
time; `TRANSIENT` is not persisted so has no partition.

### Envelope additions (all optional unless noted)

`location?`, `confidence?` (0..1), `privacyClass` (**required**:
`PUBLIC | INTERNAL | SENSITIVE | RESTRICTED`), `traceId?` (promoted from
`meta.traceId` to a top-level optional field), `evidence?: string[]`,
`expiresAt?`. Existing fields are unchanged. `principalId`, `provenance`,
`correlationId`, `causationId` remain mandatory.

### Docs updated by this amendment
`EVENT_ARCHITECTURE.md` §2/§2.1/§6/§8, `STATE_MODEL.md` §2.1,
`docs/protocols/event-envelope.md`, `GLOSSARY.md`, and
`packages/contracts/src/event.ts` + `packages/validation`.

### Reversal difficulty of the amendment
**Low.** The taxonomy is a wider enum + a policy table; envelope fields are
additive. Collapsing back to three classes is a lookup.
