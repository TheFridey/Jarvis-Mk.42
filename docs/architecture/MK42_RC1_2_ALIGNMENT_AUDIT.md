# MK.42 RC1.2 truth and alignment audit

Date: 2026-09-29

## Scope and precedence

This pass inspected `main` at `ace4d08` (`mk42-rc1.1`), the existing working
tree, recent RC/ASCENSION audits, forward-only migrations `0001`–`0013`, pnpm
workspace manifests, CI, architecture/ADR documents, and runtime/tests. Code,
migrations, tests, and current gate results outranked historical roadmap prose.

The checkout already contained an uncommitted NATS recovery hardening slice.
It was preserved and tested rather than discarded or moved. No applied
migration was edited and no new persisted authority was introduced.

## Architectural conflicts found and resolution

1. **Roadmap time drift.** MK.42–MK.50 prose described shipped systems as
   future work. `ROADMAP.md` now separates evidence-bearing current status from
   historical MK lineage.
2. **Misleading package topology.** Multiple `packages/*` folders were
   README-only while runtime code lived in `apps/core/src/kernel/*`.
   `packages/README.md` and every such seam now say that unmistakably and point
   to the implementation. Working Kernel code was not reorganised.
3. **Version ambiguity.** Component 0.42/0.43/0.47/0.49/0.50 values are MK
   lineage markers, not competing product releases. Root `productRelease` is
   `RC1.2`; event schema and protocol versions remain independent contracts.
4. **False PostgreSQL instrumentation.** `instrumentation-pg` could only patch
   node-postgres, which is absent. It was removed. Useful `postgres.js`
   transaction boundaries are explicit spans; undici covers outbound fetch.
5. **Unsafe development default at remote ingress.** Core diagnostics and the
   Model Gateway now refuse non-loopback startup with their default credentials.
   Loopback development remains available. `NODE_ENV` cannot bypass the guard.

## Observability now implemented

Domain spans cover incoming Core/Model Gateway interactions, Context
compilation, model-gateway requests, provider attempts, agent invocation,
capability invocation, authoritative event-append transactions, and outbox
publishing. Trace headers propagate through undici and are extracted at both
HTTP ingresses. Durable events retain active trace IDs.

This remains **PARTIAL**: the full ADR-0036 metric catalogue, all processes,
every fine-grained Executor stage, and live provider/collector behavior are not
certified by this pass.

## Experience target

`MARK42_EXPERIENCE_TARGET.md` defines Forge Cosmos, independent System Mode /
Interaction State / Work State, the read-only Experience Projection, truthful
model/agent animation, realtime stream, Node Protocol, surface, and ScaleSmiths
targets. It explicitly rejects Temporal and duplicate authority and states that
an Experience Projector is not a 17th Kernel component.

The first realtime slice is now implemented. `JarvisOperatingPicture` is a
typed v1 presentation contract with separate System Mode, Interaction State,
and Work State plus typed objective, cognition, agency, health, telemetry,
approval, conversation, context, and Semantic Scene fields. The in-process
projection is read-only and ephemeral. An authenticated `/experience/stream`
WebSocket provides scoped updates, bounded resume history, heartbeat credential
revalidation, revocation/logout disconnect, and backpressure protection. The
desktop snapshot is bootstrap/recovery only; normal updates are pushed and
disconnected data is visibly stale.

## Verification evidence

| Gate | Result |
|---|---|
| `pnpm install --frozen-lockfile` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS (`lint: clean`) |
| `pnpm test` | PASS — 46 files, 225 tests |
| focused Experience transport/reducer slice | PASS — 4 files, 16 tests |
| `pnpm test:contract` | PASS — 4 files, 16 tests |
| `pnpm test:security` | PASS — 3 files, 30 tests |
| `pnpm fitness` | PASS — 2 files, 17 tests |
| `pnpm test:integration` | PASS — 14 files, 78 tests against real PostgreSQL and NATS JetStream; includes Kernel restart, authenticated desktop snapshot, real subject ownership, outage/recovery, drain, and deduplication |
| `pnpm test:chaos` | PASS — 2 files, 13 tests; host-level stop/restart of real NATS, Redis, and PostgreSQL succeeded |
| `pnpm backup:drill` | PASS — `pg_dump`/`pg_restore`, restored Kernel boot, completed invocation not re-executed |
| `pnpm build:desktop` | PASS — Next production/static export |

Docker Desktop was initially unavailable during RC1.2 work. That failure was
not converted into a skip. After the daemon recovered, every Docker-backed gate
above was rerun successfully. `pnpm verify:full` was not invoked as a single
aggregate command after that recovery; every constituent command was run and
passed separately, with the final typecheck/lint/unit pass repeated after the
last code change.
