# @jarvis/events

> **README-ONLY EXTRACTION SEAM — NOT A WORKSPACE PACKAGE.** The implemented
> Event Manager, PostgreSQL ledger access, transactional outbox, JetStream bus,
> replay, and retention code live in `apps/core/src/kernel/event-fabric/`.
> Preserve that modular-monolith location unless extraction is ADR-approved.

**Purpose.** Event Manager internals (`docs/architecture/EVENT_ARCHITECTURE.md`,
ADR-0009): append to the PostgreSQL `events` ledger, the transactional
**outbox** relay to NATS JetStream, per-`type`+`schemaVersion` payload
validation at append time, event-class routing (`ledger`/`signal`/`derived`),
durable pull-consumer helpers, and idempotency (processed-set / per-subject
checkpoint) utilities.

**Owns.** The `events` schema. The outbox table + relay. JetStream stream
provisioning (`LEDGER`, `SIGNAL`, `DERIVED`).

**Depends on.** `@jarvis/contracts`, `@jarvis/protocol` (envelope codec), a
PostgreSQL client, a NATS client.

**Must not.** Let any other module write `events` directly. Publish to NATS
before the PostgreSQL transaction commits. Treat JetStream as the system of
record (PostgreSQL is).

**Extraction seam.** → a standalone event service; consumers already use the
`EventBus` interface + idempotent handlers, so the swap is a binding change.
