# packages/

In-repo libraries consumed by `apps/*`. Each has a single purpose, a public
interface, and a documented **extraction seam** (`docs/architecture/
SYSTEM_BOUNDARIES.md` §10) — the point at which it can become a separate
service without a redesign.

| Package | Purpose | Extraction seam |
|---|---|---|
| `contracts` | Shared provider-neutral types. Leaf of the graph. | n/a (types) |
| `kernel` | Kernel module framework: component base classes, port interfaces, the composition root that `apps/core` assembles. No domain logic. | n/a (framework) |
| `protocol` | Wire framing: event envelope codec, Node Protocol handshake/heartbeat. | n/a (shared lib) |
| `validation` | The Validator: schema + safety + provenance-tainting for every untrusted → Kernel path. | co-locate with ingress |
| `events` | Event Manager internals: `events` table access, outbox, NATS publish/consume, idempotency helpers. | → event service |
| `state` | State Manager internals: projector framework, checkpoints, read-model rebuild, `asOfEventPosition`. | → state service |
| `context` | Context Compiler: multimodal fusion, budget/priority-tier assembly, unknown marking. | co-locate with knowledge |
| `world-model` | Entities, facts, evidence, temporal queries, belief revision, ingestion. | → knowledge service |
| `memory` | Episodes, summaries, pgvector recall, decay/compaction. | → knowledge service |
| `objectives` | Objective Engine: decomposition, success criteria, serialised transitions. | → planning service |
| `models` | Model Registry types + routing-policy library (no provider SDKs). | stays with Kernel |
| `capabilities` | Capability Registry + the Executor pipeline + adapter host contract. | Executor stays with Kernel; adapters already out-of-process |
| `permissions` | Policy Engine (deterministic evaluator + rule DSL) + Permission Engine (grants, tokens, approvals). | stays with Kernel |
| `agents` | Agent Runtime: lease, sandbox, budget, control channel, reaping. | → orchestration service |
| `spatial` | Coordinate spaces, transforms, bounding volumes. | with scene |
| `scene` | Scene Graph: surfaces, node poses, entity spatial extent (ADR-0015). | → scene service |
| `telemetry` | OpenTelemetry setup, trace/metric helpers, correlation-id ↔ trace-id bridging. | shared lib |
| `sdk` | The client library Experience-Plane apps use: typed read subscriptions + `Command`/`Proposal` submission. Never exposes a store. | n/a (client) |

## Rules

- A package exposes a public interface (`src/index.ts`) and nothing else;
  internals are not importable across packages.
- `contracts` depends on nothing. Everything may depend on `contracts`.
- No package imports a provider SDK except an adapter under `apps/gateway`.
- No package under `packages/` performs an effect — effects go through the
  Executor in `capabilities` (invoked by the Kernel).
