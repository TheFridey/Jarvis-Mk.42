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

MK.42 currently ships:

1. The **architectural constitution** — `docs/architecture/`
2. **Architecture Decision Records** — `docs/architecture/adr/`
3. **Diagrams** — `docs/architecture/diagrams/`
4. A running modular Kernel with durable events, state, identity, sessions, health, context and Agency Plane composition
5. Typed, runtime-validated contracts plus unit, integration, contract, security, fitness, chaos and restore gates
6. A Tauri/Next.js desktop experience prototype and isolated capability-worker host

This is a hardened foundation, not a finished assistant. Model Gateway provider
execution, production Node Protocol trust, complete perception/voice services,
and autonomous operation remain incomplete and must not be inferred from the UI.

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
