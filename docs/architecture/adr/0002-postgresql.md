# ADR-0002: PostgreSQL as the authoritative store

Status: Accepted
Date: 2026-08-31
Deciders: Principal Architect

## Context
JARVIS has one authoritative logical system state (L5): the Event Log
(append-only history) and Projected State (current values), plus the World
Model and Memory as separate schemas. We need: transactional writes coupling a
state change to its event (outbox pattern, `EVENT_ARCHITECTURE.md`), strong
consistency for grants/policy/objectives, rich querying for the World Model's
temporal facts, vector similarity for Memory recall, partitioning for retention
(`STATE_MODEL.md` §2.1), and operational simplicity on a single local server.

## Decision
Use **PostgreSQL** as the single authoritative datastore for **all**
authoritative data: `events`, `projections.*`, `world_model.*`, `memory.*`,
`audit.*`. Use native partitioning for event classes and time. Use the
`pgvector` extension for embeddings (ADR-0011). One database, multiple schemas,
per-schema database roles enforcing the no-cross-domain-access rule
(`DATA_OWNERSHIP.md` §3).

## Alternatives considered
- **EventStoreDB for the log + PostgreSQL for the rest** — purpose-built event
  store, but a second system to operate, no transactional outbox with the
  read-model DB, and overkill at our event volume.
- **SQLite** — great for single-node simplicity, but weak concurrent-writer
  story, no rich partitioning, and a painful path to the local-server /
  multi-node future.
- **MongoDB / document store** — loses relational integrity for the World
  Model's entity/relationship/evidence graph and transactional outbox.
- **A graph database (Neo4j) for the World Model** — attractive for the
  evidence graph, but a second store, and Postgres recursive queries +
  well-designed tables cover MK.42 needs. Revisit if graph traversal becomes a
  bottleneck.

## Benefits
- One transactional boundary for state-change + event + outbox.
- Strong consistency where the constitution demands it.
- Temporal fact queries, recursive relationship queries, JSONB for flexible
  payloads, partitioning for retention — all native.
- `pgvector` keeps embeddings in the same store (no sync problem).
- Trivial to run in Compose; excellent backup/PITR story (`STATE_MODEL.md` §8).
- Ubiquitous operational knowledge for a ten-year project.

## Disadvantages
- A single logical database is a shared dependency; its outage fails state
  writes closed (`FAILURE_MODEL.md` — accepted, by design).
- Vector search at very large scale is weaker than dedicated engines
  (acceptable for MK.42; revisit per ADR-0011).
- Requires disciplined schema/role separation to prevent cross-domain coupling.

## Risks
- Growth of the event table. Mitigated by event classes + partition-drop of
  signal events + cold-storage of old audit partitions (`STATE_MODEL.md` §6).
- Team taking shortcuts with cross-schema joins. Mitigated by per-schema roles
  that make it fail at the connection level.

## Consequences
- The outbox pattern is mandatory for any state change that emits an event.
- Each Kernel module connects with a role scoped to its schema + read-only
  `events`.
- Backups target Postgres + object storage only; Redis is never backed up.
- Extraction (`SYSTEM_BOUNDARIES.md` §10) gives each extracted service its own
  schema connection, not its own database engine, until proven necessary.

## Reversal difficulty
**Severe.** Postgres is the spine's persistence. Replacing it means migrating
the Event Log, every projection, the World Model graph, Memory, and audit,
plus re-implementing the transactional outbox on a new engine. Avoid; evolve
within Postgres (add read replicas, extract schemas to their own instances)
instead.
