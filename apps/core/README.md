# apps/core — the JARVIS Kernel

The protected core (`docs/architecture/KERNEL_CONSTITUTION.md`). MK.43 delivers
the **Nervous System**: deterministic operating infrastructure, no AI.

> **MK.43 deviation from ADR-0001:** this is a plain composition root, not a
> NestJS app (the NestJS dependency tree could not be installed on the build
> machine — an external drive with pathological pnpm link times). Every
> component is still a bounded unit with an interface; NestJS wrapping is
> mechanical. Full detail + restoration path:
> [`docs/architecture/MK43_IMPLEMENTATION_NOTES.md`](../../docs/architecture/MK43_IMPLEMENTATION_NOTES.md).

## Layout

```
src/
  runtime/         clock, ids (monotonic ULID), config, tx runner, mutex
  kernel/
    event-fabric/  envelope validation, append-only store (partitioned),
                   transactional outbox + relay, in-process & NATS buses,
                   idempotency, dead-letter, replay engine (replay != re-exec),
                   retention sweeper
    state/         authoritative versioned slices, optimistic-concurrency
                   mutation pipeline, subscriptions, snapshots, projector
    mode/          7-mode deterministic transition table + manager (ADR-0019)
    identity/      principals/identities/trust, AuthContext, scrypt bootstrap
    session/       7 session types, lifecycle state machine, handoff
    presence/      deterministic derivation from observable evidence only
    health/        per-subsystem status, roll-up, "diagnose yourself"
    scheduler/     interval/cron/once internal routines, bounded retry
    notification/  interruption gate (severity x urgency x mode x presence)
    context/       deterministic Intent-Specific Context Package (no AI)
    diagnostics/   read-only report + node:http surface
    lifecycle/     buildKernel(), cold start, graceful shutdown, routines
  main.ts          entrypoint (SIGINT/SIGTERM handling)
test/              integration + resilience (real Postgres via docker CLI)
```

## Run

```
pnpm stack:up          # Postgres + Redis + NATS + MinIO + OTel collector
pnpm db:migrate        # apply SQL migrations
pnpm --filter @jarvis/core dev
# -> [kernel] operational  mode=AMBIENT  diagnostics=http://localhost:7420/diagnostics
```

## Invariants (enforced + tested)

- The only writer of authoritative state. Two mutations against the same base
  version → exactly one accepted (row lock).
- The only path that emits events; every event is schema-validated at append;
  malformed events never enter the store.
- `TRANSIENT` events are never persisted. `AUDIT`/`SECURITY` go to
  tamper-evident partitions, retained indefinitely.
- Replay feeds pure projectors only; effect-causing consumers reject
  `meta.replay=true`.
- Modes never weaken a policy decision. Illegal transitions are rejected.
- Runs its core decision loop with NATS and Redis down (PostgreSQL required).
