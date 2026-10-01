# Package topology

`packages/` contains both real pnpm workspace libraries and historical
README-only extraction seams. A directory without `package.json` is not an
importable package and does not indicate where implementation belongs.

## Real workspace packages

| Package | Current responsibility |
|---|---|
| `contracts` | Provider-neutral shared contracts; leaf of the graph. |
| `validation` | Runtime boundary and canonical event validation. |
| `persistence` | PostgreSQL client, Drizzle schema, and forward-only migrations. |
| `permissions` | Pure policy/permission rules used by the Kernel. |
| `capability-sdk` | Capability authoring, schemas, codegen, lint, and testkit. |
| `scene` | Semantic Scene Graph and transport-neutral scene behavior. |
| `spatial` | Coordinate and spatial primitives. |
| `telemetry` | OpenTelemetry SDK, trace propagation, supported instrumentation, and span helpers. |
| `testkit` | Ephemeral infrastructure and test factories. |
| `windows-driver` | Windows-specific driver boundary. |

Each has `package.json`, source exports, and a place in the pnpm graph.

## README-only extraction seams

| Directory | Implemented location / actual status |
|---|---|
| `kernel` | Composition and components: `apps/core/src/kernel/*`. |
| `events` | `apps/core/src/kernel/event-fabric/`. |
| `state` | `apps/core/src/kernel/state/`. |
| `context` | `apps/core/src/kernel/context/`. |
| `world-model` | ATLAS: `apps/core/src/kernel/atlas/` and `knowledge/`. |
| `memory` | MNEMOSYNE: `apps/core/src/kernel/mnemosyne/` and `knowledge/`. |
| `objectives` | `apps/core/src/kernel/objective/` and `scheduler/`. |
| `models` | Kernel cognition client plus `apps/gateway/` provider routing. |
| `capabilities` | Kernel registry/executor plus `apps/adapter-host/`. |
| `agents` | `apps/core/src/kernel/cognition/agent-runtime.ts`. |
| `protocol` | Partial target; contracts and Kernel node lifecycle exist, but no importable protocol package. |
| `sdk` | Planned general client; current desktop uses authenticated ingress and `SceneTransport`. |

These directories are retained because they document stable future extraction
boundaries. They must not attract duplicate implementations or be used to
justify moving working modular-monolith code without an accepted ADR.

## Rules

- PostgreSQL and the Kernel remain authoritative; extraction seams add no
  authority.
- Real packages expose `src/index.ts`; consumers never import README seams.
- `contracts` depends on nothing. Provider SDKs stay inside Model Gateway
  adapters. Effects stay behind Policy, Permission, Approval, and Executor.
- README seams may become packages only when they have a concrete consumer,
  ownership, tests, and an ADR-backed extraction need.
