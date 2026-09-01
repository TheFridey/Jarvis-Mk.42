# ADR-0004: Redis for ephemeral runtime state

Status: Accepted
Date: 2026-08-31
Deciders: Principal Architect

## Context
The system has state that is operational, high-churn, latency-sensitive, and
**reconstructible**: session liveness, node liveness, presence-current,
locks/leases, rate-limit counters, authority-token cache, notification unread
counts, UI pub/sub. Putting this in PostgreSQL adds write load and latency for
data that need not survive a restart (`DATA_OWNERSHIP.md` §2).

## Decision
Use **Redis** for Ephemeral Runtime State only. Redis **never owns**
authoritative data. Everything in Redis is either a cache of a PostgreSQL-
derived value or a transient operational value rebuildable from live
connections. Losing Redis degrades latency and forces re-derivation; it loses
nothing authoritative (`FAILURE_MODEL.md` §Redis).

## Alternatives considered
- **In-process memory only** — fine for a single Kernel process, but the
  gateway, perception, and future extracted services need shared ephemeral
  state (leases, rate limits) — needs a shared store.
- **PostgreSQL `UNLOGGED` tables** — one fewer system, but still WAL-adjacent
  overhead, worse latency, and blurs the "authoritative vs ephemeral" line the
  constitution draws sharply.
- **NATS KV** — viable, keeps systems count down; rejected for MK.42 because
  Redis's data structures (sorted sets for rate limits, pub/sub for UI, TTLs)
  are a better fit and operationally trivial. Revisit if reducing moving parts
  becomes a priority.

## Benefits
- Sub-millisecond reads/writes for the interaction loop.
- Native TTLs (authority tokens), sorted sets (rate limiting), pub/sub (UI
  liveness), atomic ops (leases).
- Clear architectural signal: "if it's in Redis, it's not authoritative."
- One container in Compose.

## Disadvantages
- A third data system to run and monitor.
- Persistence is possible but we deliberately do not rely on it.

## Risks
- Team accidentally treating Redis as a source of truth. Mitigated:
  `DATA_OWNERSHIP.md` forbids it explicitly; reviews enforce; recovery
  procedures assume Redis is empty.

## Consequences
- Redis is not backed up.
- Every Redis key has a documented rebuild path.
- Rate limits fail safe (conservative in-memory limits) if Redis is down.

## Reversal difficulty
**Low.** Ephemeral state is accessed through a small `EphemeralStore` interface.
Swapping Redis for NATS KV or an embedded store is a single adapter change.
