# ADR-0005: NATS JetStream as event transport

Status: Accepted
Date: 2026-08-31
Deciders: Principal Architect

## Context
Events must fan out from the Kernel to many consumers (projectors, World Model
ingestion, Notification, Audit, perception subscribers, future extracted
services), support replay/catch-up, apply backpressure, and tolerate consumer
outages — without becoming the system of record (that is PostgreSQL,
ADR-0002/0009). We also want a transport that doubles as the RPC substrate for
the modular-monolith extraction seam (`SYSTEM_BOUNDARIES.md` §10) and for
node↔Kernel messaging.

## Decision
Use **NATS with JetStream**. Three streams: `LEDGER`, `SIGNAL`, `DERIVED`
(`EVENT_ARCHITECTURE.md` §3), with durable pull consumers, explicit ack,
max-deliver, and dead-letter subjects. NATS core request/reply is the RPC
mechanism for in-process→service extraction and for Node Protocol control
messages. PostgreSQL remains the authority; JetStream retention is a bounded
recent-history buffer, not the archive.

## Alternatives considered
- **Kafka / Redpanda** — the industry default for event streaming, but heavy
  to operate on a single local server, partition management overhead, and more
  than MK.42's volume needs. Redpanda softens ops but still heavier than NATS.
- **RabbitMQ** — solid queuing, weaker replay/stream semantics, no natural RPC
  substrate.
- **PostgreSQL `LISTEN/NOTIFY` + polling the `events` table** — zero extra
  infra, and we *do* use table-tailing as the NATS-down fallback
  (`FAILURE_MODEL.md`). But `NOTIFY` has payload limits, no durable consumer
  groups, no backpressure, and poor fan-out — inadequate as the primary path.
- **Redis Streams** — possible, but conflates with the ephemeral store
  (ADR-0004) and has weaker consumer-group ergonomics than JetStream.

## Benefits
- Lightweight single binary; trivial in Compose; low ops burden.
- JetStream gives durable consumers, replay, ack, DLQ, and per-subject
  ordering.
- One technology for events + service RPC + node messaging reduces moving
  parts.
- Excellent latency and throughput headroom well beyond MK.42 needs.
- Subject hierarchy maps cleanly to `jarvis.<plane>.<domain>.<name>`.

## Disadvantages
- Smaller enterprise mindshare than Kafka; fewer turnkey connectors.
- JetStream operational nuances (storage limits, consumer config) to learn.
- Not the system of record — requires the discipline that PostgreSQL is
  (enforced by the outbox pattern).

## Risks
- Message loss on misconfiguration. Mitigated: PostgreSQL is authoritative;
  projectors can always rebuild from `events`; consumers idempotent on
  `Event.id`.
- Outgrowing NATS at large multi-node scale. Mitigated: consumers already only
  depend on per-subject ordering + idempotency, so a later swap to Kafka is
  contained.

## Consequences
- The outbox relay publishes to JetStream after the PostgreSQL transaction
  commits.
- Every consumer is a durable pull consumer, idempotent, with a DLQ.
- After a short NATS outage the Kernel catches projectors up directly from
  `events` rather than waiting for NATS.

## Reversal difficulty
**Moderate.** Publishers and consumers use a thin `EventBus` interface.
Replacing NATS with Kafka/Redpanda is an adapter swap plus stream/topic
re-provisioning; consumer logic (idempotent, per-subject ordered) is
unchanged. The RPC-substrate use would also need re-hosting (Nest transport).
