# ADR-0003: Drizzle ORM

Status: Accepted
Date: 2026-08-31
Deciders: Principal Architect

## Context
Kernel modules need typed database access to their own PostgreSQL schema, with
migrations, without an ORM that encourages cross-aggregate object graphs or
hides SQL cost. We want SQL to stay visible (event stores, projections, and
temporal fact queries are performance-sensitive) and types to be derived from
the schema.

## Decision
Use **Drizzle ORM** with `drizzle-kit` migrations. Each schema
(`events`, `projections`, `world_model`, `memory`, `audit`, per-module) is a
Drizzle schema module. Queries are written as Drizzle query-builder
expressions; raw SQL is allowed and expected for projections and temporal
queries. No lazy-loaded relations, no cross-schema relation objects.

## Alternatives considered
- **Prisma** — great DX, but a separate schema language, a query engine
  binary, historically weaker raw-SQL ergonomics and partitioning support, and
  it nudges toward a single global schema.
- **TypeORM** — mature but heavy, active-record temptations, migration
  friction.
- **Kysely (query builder, no ORM)** — very close call; excellent SQL
  fidelity. Drizzle chosen for schema-derived types + integrated migrations
  while keeping SQL-first ergonomics. Kysely remains a low-cost fallback.
- **Raw `pg` + hand-written types** — maximum control, too much boilerplate
  for a decade-long codebase.

## Benefits
- Types derived from schema definitions; no drift.
- SQL stays legible; partitioning, `pgvector` operators, CTEs, and window
  functions are usable directly.
- Lightweight; no engine binary; fast cold start.
- Per-schema modules reinforce the ownership boundary.

## Disadvantages
- Younger ecosystem than Prisma/TypeORM; some rough edges in tooling.
- Fewer high-level conveniences (by design; we consider this a benefit).

## Risks
- Library churn. Mitigated: our usage is schema definitions + query builder +
  migrations, and the escape hatch to raw SQL / Kysely is cheap because
  queries are already SQL-shaped.

## Consequences
- Migrations are versioned per schema and run at deploy; projections can be
  rebuilt independently of migrations (`STATE_MODEL.md` §3).
- Repositories expose narrow methods to their module; no repository is exported
  across module boundaries.

## Reversal difficulty
**Low.** Data access is isolated behind per-module repository interfaces.
Swapping Drizzle for Kysely or raw `pg` is a per-repository change with no
impact on contracts, events, or business logic.
