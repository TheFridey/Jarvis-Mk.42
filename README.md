# JARVIS MK.42

A persistent, event-driven artificial-intelligence **operating layer**.

Not a chatbot. Not an LLM wrapper. Not a collection of agents. JARVIS is the
identity, state, event fabric, world model, memory, objectives, policy,
permission, capability, routing, orchestration, perception, planning,
execution, verification, and audit layer that *uses* replaceable AI providers
as cognitive resources.

> **The models are not JARVIS.** OpenAI, Anthropic, Gemini, local models, TTS,
> vision — all replaceable. JARVIS is what persists around them.

## Current status

As verified by an independent hostile audit (`docs/architecture/AUDIT_MK42_ASCENSION_II.md`, 2026-09-08), MK.42 currently ships:

1. The **architectural constitution** — `docs/architecture/`
2. **Architecture Decision Records** — `docs/architecture/adr/`
3. **Diagrams** — `docs/architecture/diagrams/`
4. A running modular Kernel (`apps/core`) with durable events (NATS JetStream + transactional outbox), single-writer state, identity, sessions, health, and a real Agency Plane: policy, permission, approval, credential broker, durable invocation lifecycle, verified execution, and rollback all backed by Postgres and enforced end-to-end — no bypass of the single Executor pipeline was found under adversarial review.
5. A working cognition path: provider-neutral Model Gateway (Anthropic/OpenAI/OpenAI-compatible behind one interface, secrets kept in the gateway process), an Objective Engine that can reason/plan/propose but never execute directly, and malformed/off-scope model output that is schema-rejected before it can become an action.
6. Working voice (local Windows speech recognition, Kernel-owned session state, real barge-in, device-loss recovery) and vision (frames stay local by default, cloud vision requires an explicit approved selected-frame path, Air Touch gestures are signal-only and route through the same approval pipeline as everything else, ambiguous gestures never silently become actions).
7. Typed, runtime-validated contracts plus unit, integration (real ephemeral-Postgres), contract, security, fitness, and chaos gates, and a backup/restore drill against real Postgres — the latter proves transactional round-tripping, not disaster recovery (no `pg_dump`/`pg_restore`, no separate storage target).
8. A Tauri/Next.js desktop experience prototype and isolated capability-worker host.

**Known gaps, stated plainly:**

- **Observability (ADR-0036)** is API surface only — no `TracerProvider` is ever registered, so no real spans or trace correlation exist in production despite the package existing.
- **Node Protocol v1 (ADR-0037)** is a design document only — `packages/protocol` has no implementation; every event still carries a single static `nodeId`. Its ADR title previously claimed otherwise; that has been corrected.
- **ATLAS (world model) and MNEMOSYNE (memory/retrieval)** are named throughout the docs and ADR-0022/0023 but have no implementation — `packages/world-model` and `packages/memory` are README stubs. Context is currently compiled from flat state slices and recent events only.
- Session/bearer tokens are not invalidated on logout at the gateway layer — a residual finding from this audit, tracked for follow-up.

This is a hardened agency-plane foundation with working cognition, voice, and
vision — not a finished assistant, and not yet distributed (single-node only).

## Read in this order

1. [`docs/architecture/PRINCIPLES.md`](docs/architecture/PRINCIPLES.md) — the 40 laws
2. [`docs/architecture/MK42_ARCHITECTURE.md`](docs/architecture/MK42_ARCHITECTURE.md) — the whole system in one document
3. [`docs/architecture/KERNEL_CONSTITUTION.md`](docs/architecture/KERNEL_CONSTITUTION.md) — what the Kernel is and is not
4. [`docs/architecture/README.md`](docs/architecture/README.md) — index of every model document
5. [`docs/architecture/GLOSSARY.md`](docs/architecture/GLOSSARY.md) — precise vocabulary

## Structure

| Path | Purpose |
|---|---|
| `apps/` | Deployable processes. `core` = Kernel. `gateway` = Model Gateway. `voice`/`vision` = perception. `desktop` = Tauri shell. `diagnostics` = operator UI. `relay` = future edge node (empty seam). |
| `packages/` | In-repo libraries consumed by apps. `contracts` = shared types. `kernel` = Kernel module code. See `packages/README.md`. |
| `agents/` | Disposable cognitive-worker manifests. The full Agent Runtime remains incomplete. |
| `capabilities/` | Permissioned effect manifests; selected providers include executable adapters. Every consequential action must pass through the Kernel Executor. |
| `infrastructure/` | Docker Compose, Postgres, Redis, NATS, observability configuration. |
| `docs/` | Architecture, ADRs, protocols, security, diagrams. |

## Deployment target for MK.42

One developer **workstation** (Tauri desktop app + perception) plus one
always-on **local server** on the LAN (Kernel, Postgres, Redis, NATS, object
storage), orchestrated with Docker Compose. Cloud is used **only** for frontier
model APIs, reached through the Model Gateway. GPU / edge / AR / robotics nodes
are future node types that attach through the Node Protocol without a Kernel
rewrite.
