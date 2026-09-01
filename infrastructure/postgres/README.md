# infrastructure/postgres

PostgreSQL is the **only** authoritative datastore (ADR-0002, ADR-0017).

## Init scripts (run in order)

1. `00-extensions.sql` — `CREATE EXTENSION vector;` (pgvector, ADR-0011).
2. `10-schemas.sql` — create schemas: `identity`, `session`, `events`,
   `projections`, `policy`, `catalogue`, `world_model`, `memory`, `audit`,
   `scene`.
3. `20-roles.sql` — one DB role per Kernel module, each `GRANT`ed on **its own
   schema only** plus `SELECT` on `events` (`DATA_OWNERSHIP.md` §3). This is
   what makes cross-domain access fail at the connection level.
4. `30-partitions.sql` — `events` partitioned by `class` (list) then by `time`
   (range, monthly). Signal partitions are dropped past the 7-day window;
   audit/ledger old partitions are detached to cold storage.
5. `40-vector-indexes.sql` — HNSW indexes on `memory.*` and
   `world_model.entities` embedding columns.

## Backup

- Continuous WAL archiving to `minio://pg-wal`.
- Nightly `pg_basebackup` to `minio://pg-wal/base/`.
- This covers **everything authoritative** (Event Log, Projected State, World
  Model, Memory metadata, Audit). Recovery = restore + Kernel cold start
  (`STATE_MODEL.md` §7–§8).

## Not here

Migrations for module tables live with each package (`drizzle-kit`, ADR-0003)
and run at deploy. These init scripts only establish schemas, roles,
extensions, and partitioning.
