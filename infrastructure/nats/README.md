# infrastructure/nats

NATS with **JetStream** — event transport, fan-out, replay buffer,
backpressure, and the RPC substrate for future module extraction (ADR-0005). It
is **not** the system of record; PostgreSQL `events` is.

## Streams

| Stream | Subjects | Retention | Storage |
|---|---|---|---|
| `LEDGER` | `jarvis.*.*.*` (class=ledger) | ~30 days (PostgreSQL is the archive) | file |
| `SIGNAL` | `jarvis.perception.>` | 7 days OR size cap, whichever first | file |
| `DERIVED` | derived/notification subjects | hours | memory/file |

## Consumers

Durable **pull** consumers, explicit ack, `max_deliver` set, per-consumer
dead-letter subject (`jarvis.dlq.<consumer>`). Every consumer is idempotent on
`Event.id`. A consumer that falls outside a stream's retention window backfills
from PostgreSQL `events`, then rejoins live.

## Credentials (scoped per process)

| Account / user | Can publish | Can subscribe |
|---|---|---|
| `kernel` | all `jarvis.*` ledger/derived subjects | all |
| `perception` | `jarvis.perception.>` only | none (or its own control subject) |
| `gateway` | `jarvis.cognition.model.>` only | its request subject |
| `nodes/<id>` | only its declared observation subjects | only its granted subscriptions |

## Outbox relay

The Kernel's outbox relay publishes to JetStream **after** the PostgreSQL
transaction commits. Consumers never assume JetStream has an event PostgreSQL
lacks.
