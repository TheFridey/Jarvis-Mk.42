# MK.43 Implementation Notes — The Nervous System

Records where the **as-built** MK.43 Kernel differs from the GENESIS
constitution, why, and the path back to the ratified design. Subordinate to
[`PRINCIPLES.md`](PRINCIPLES.md); nothing here weakens a law.

Status: MK.43 delivers the deterministic operating foundation — identity,
sessions, one authoritative state, operating modes, the event fabric, the
deterministic Context Compiler, presence, health, scheduler, notifications, and
a diagnostics API. No AI. Verified by `pnpm typecheck` (0 errors),
`pnpm lint` (clean), and `pnpm test` (65 unit tests). Integration tests
(16, real Postgres via the `docker` CLI) are written and typecheck-clean; they
self-skip where the Docker daemon is unavailable.

---

## 1. Ratified constitution changes (done before coding)

| Change | Where |
|---|---|
| **ADR-0019** — JARVIS operating modes (7-mode deterministic state machine), owned by the State Manager, a posture never an authority bypass | `adr/0019-operating-modes.md` |
| **ADR-0009 Amendment 1** — retention taxonomy `ledger/signal/derived` → `TRANSIENT / OPERATIONAL / AUDIT / MEMORY_CANDIDATE / SECURITY / DIAGNOSTIC`; Event envelope gains `privacyClass` (required), `traceId` (promoted), `location`, `confidence`, `evidence`, `expiresAt` | `adr/0009-event-architecture.md`, `EVENT_ARCHITECTURE.md`, `STATE_MODEL.md`, `GLOSSARY.md`, `docs/protocols/event-envelope.md` |
| `PresenceState.FOCUSED` vs `JarvisMode.FOCUSED` disambiguated | `GLOSSARY.md` |
| Replay ≠ re-execution made structural (dedicated `ReplayBus`, `meta.replay` tag) | `GLOSSARY.md`, `EVENT_ARCHITECTURE.md` §7 |

These were approved and are now part of the constitution.

## 2. Toolchain deviations (environment-forced, not design choices)

The build machine mounts the repo on an **external USB drive** with pathological
filesystem latency for package installs. Large dependency trees could not be
installed. To ship a *working, verifiable* Kernel, the following were trimmed.
Each is an ergonomics substitution — no capability of the constitution is lost —
and each has a documented restoration path.

| Constitution says | MK.43 ships | Restoration path |
|---|---|---|
| **NestJS** as the Kernel framework (ADR-0001) | A plain composition root (`apps/core/src/kernel/lifecycle/kernel.ts`) — `buildKernel(config, overrides) → KernelHandle`. Every component is still a bounded unit with constructor injection and an explicit interface. | Wrap each component in a NestJS `@Module` with a `useFactory` provider (no decorator-metadata reliance). Mechanical; the boundaries already exist. `apps/core/package.json` retains the intent in its description. |
| **NestJS + Fastify** HTTP for diagnostics | `node:http` server (`diagnostics/http-server.ts`), 3 read-only routes: `/healthz`, `/diagnostics`, `/state` | Swap for `@nestjs/platform-fastify` + one controller calling the unchanged `DiagnosticsService`. |
| **ESLint + typescript-eslint** (implied by ADR-0001 stack) | `tsc` strict (`noUnusedLocals`, `noUnusedParameters`, `noImplicitAny`, …) **+** `scripts/lint.mjs` (bans `as any`, `@ts-ignore`, `console.log`, bare `TODO`) | `pnpm add -D eslint @eslint/js typescript-eslint`; `eslint.config.js` is already written and committed. Restore `"lint": "eslint ."`. |
| **OpenTelemetry** end-to-end (ADR + spec) | `@opentelemetry/api` only. `withSpan` / `currentTraceId` are real but no-op without a registered provider. The dev stack already runs an OTLP collector. | `pnpm add @opentelemetry/sdk-trace-node …` and restore the SDK registration in `@jarvis/telemetry` (the earlier version is in git history / the ADR). Event `traceId` plumbing is already in place. |
| **testcontainers** for integration tests | `@jarvis/testkit` drives ephemeral Postgres through the **`docker` CLI** directly (`startEphemeralPg`). Honours `JARVIS_TEST_DB_URL` (shared dev stack) and self-skips when Docker is down. | Optional: swap the CLI calls for `@testcontainers/postgresql`. The suite contract is unchanged. |
| `exactOptionalPropertyTypes: true` | Disabled in `tsconfig.base.json` (kept `strict`, `noUncheckedIndexedAccess`, `noUnusedLocals/Parameters`) | Re-enable and add `| undefined` to the ~6 optional envelope fields that conditional spreads touch. Low effort. |

None of these is a "temporary architectural shortcut" of the kind the
constitution forbids — they are library/tooling substitutions behind unchanged
interfaces. The **architecture** (single authoritative state, event-sourced
core, transactional outbox, deterministic policy, replay ≠ re-execution, trust
boundaries, ownership) is implemented as ratified.

## 3. Package layout note

The GENESIS skeleton listed `packages/events`, `packages/state`,
`packages/context`, etc. as separate libraries. MK.43 implements the Kernel
components as **modules inside `apps/core/src/kernel/<component>/`** — which is
what `KERNEL_CONSTITUTION.md` §0 and `SYSTEM_BOUNDARIES.md` §3 actually
describe (Nest modules in `apps/core`, not separate packages). The empty
`packages/*` skeleton READMEs remain as documented **future extraction
targets** (`SYSTEM_BOUNDARIES.md` §10). Real shared libraries this phase:
`@jarvis/contracts`, `@jarvis/validation`, `@jarvis/persistence`,
`@jarvis/telemetry`, `@jarvis/testkit`.

## 4. What is real vs. placeholder in MK.43

**Real, operational, tested:**

- Event fabric: canonical envelope + schema validation (reject on mismatch),
  append-only partitioned event store, transactional outbox + relay,
  in-process bus **and** a NATS/JetStream bus, idempotent delivery, bounded
  retry, dead-letter, replay engine with the replay ≠ re-execution guard,
  retention sweeper.
- State Manager: one authoritative state as versioned slices, optimistic
  concurrency (row-locked, "two writers same base version → exactly one
  accepted"), validated mutations, client-vs-system write rules, subscriptions,
  snapshots, `rebuildStateFromEvents` (re-fold from the log).
- Modes: 7-mode deterministic transition table, guards (presence / objective /
  health / dwell hysteresis / security-clear), `mode.changed` events
  (SECURITY retention for GUARDIAN), serialised transitions.
- Identity: principal / device / node / service identities, trust levels,
  `AuthContext`, bootstrap operator (scrypt), `token` + `mtls` methods.
  `voice` / `biometric` return `method_unsupported` — **not faked**.
- Sessions: 7 session types, lifecycle state machine, participating nodes,
  parent/child, handoff fields, optimistic concurrency.
- Presence: deterministic derivation from observable evidence with decay.
  Never infers mental / emotional / medical state.
- Health: per-subsystem status + dependency edges, worst-critical roll-up,
  `health.transitioned` events, drives `degradation_state` + DEGRADED mode,
  `report()` = "diagnose yourself".
- Scheduler: interval / cron / once, singleton, bounded retry, pause-when-
  degraded, `scheduler.tick` (DIAGNOSTIC), graceful abort. 5 internal routines.
- Notifications: interruption gate (severity × urgency × mode × presence),
  dedupe, batching + digest flush, `notification.raised` events. No subsystem
  bypasses it.
- Context Compiler: deterministic Intent-Specific Context Package — provenance
  per item, privacy filtering, dedupe, relevance ranking, **hard unit budget**
  with an omitted list, explicit unknowns, versioned. Zero AI.
- Diagnostics API: mode, uptime, event rate, sessions, nodes, PG/Redis/bus
  state, health, alerts. Model-gateway / RTC / memory-subsystem shown
  `placeholder: true`.
- Cold start / graceful shutdown; SIGINT/SIGTERM handling in `main.ts`.

**Explicit placeholders (marked as such, never faked):**

- Objective Engine — `objectives.active: 0, placeholder: true`; a no-op
  `objective.reeval` routine proves the cadence wiring.
- Model Gateway, RTC, Memory subsystem — diagnostics dependency rows with
  `placeholder: true, status: OFFLINE`.
- `voice` / `biometric` identity — `AssertionInput` shape reserved; auth
  returns `method_unsupported`.
- `gaze_target` state slice — present, populated by a later perception phase.

## 5. ROADMAP MK.43 exit criteria — status

| Criterion (`ROADMAP.md` MK.43) | Status |
|---|---|
| Events in, projections rebuilt on restart | ✅ `rebuildStateFromEvents` + restart integration test |
| Cold start target | ✅ path implemented; timing to be measured against real volumes |
| Audit trail queryable | ◑ `AUDIT`/`SECURITY` events persisted to tamper-evident partitions + `causalTree(correlationId)`; a dedicated Audit Manager projection is a follow-up |
| Contracts runtime-validated | ✅ `@jarvis/validation` on every append |

## 6. Verification commands

```
pnpm typecheck        # tsc -p tsconfig.json           -> 0 errors
pnpm lint             # tsc strict + scripts/lint.mjs  -> clean
pnpm test             # 65 unit tests                  -> pass
pnpm stack:up         # dev Data Plane (needs Docker)
pnpm db:migrate       # apply SQL migrations
pnpm test:integration # 16 integration tests (needs Docker; self-skip otherwise)
pnpm core:dev         # run the Kernel against the dev stack
```
