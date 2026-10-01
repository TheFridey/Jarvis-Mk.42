# @jarvis/state

> **README-ONLY EXTRACTION SEAM — NOT A WORKSPACE PACKAGE.** The implemented
> State Manager, projector, store, subscriptions, and slice validation live in
> `apps/core/src/kernel/state/`. This directory is not an alternate state
> authority.

**Purpose.** State Manager internals (`docs/architecture/STATE_MODEL.md`,
ADR-0017): the projector framework (`(readModel, event) → readModel`, pure,
idempotent on `Event.id`), per-read-model checkpoints, **single-writer**
enforcement (one projector per read model), rebuild-from-zero, and the
`asOfEventPosition` read-your-writes wait.

**Owns.** The `projections.*` schemas (as the sole writer, via projectors) and
projection checkpoints. Serves authoritative read APIs.

**Depends on.** `@jarvis/contracts`, `@jarvis/events` (to consume), a
PostgreSQL client.

**Must not.** Allow two projectors on one read model. Let an interface or agent
write a projection. Serve a stale read without a freshness marker when the
caller asked for read-your-writes.

**Extraction seam.** → a state service; read APIs are already an interface.
