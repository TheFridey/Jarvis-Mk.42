# JARVIS Mark 42

For the current code-gate baseline, implemented technologies and remaining live
qualification, see [RELEASE_BASELINE.md](docs/architecture/RELEASE_BASELINE.md).

For clean Windows/Linux installs, pinned tooling, native prerequisites and
generated evidence retention, see [reproducible setup](docs/repository/REPRODUCIBLE_SETUP.md)
and [artifact policy](docs/repository/ARTIFACT_POLICY.md).

JARVIS is a persistent, event-driven AI operating layer. A single authoritative Kernel coordinates temporal world knowledge (ATLAS), memory (MNEMOSYNE), provider-neutral model routing, isolated cognitive workers, permissioned agency and realtime desktop/mobile/wall projections. Models are replaceable cognitive resources; identity, state, approvals, execution and verification remain in the Kernel.

The desktop exposes observed model selection, agent jobs, telemetry, conversation, business-source provenance and capability lifecycle through Forge Cosmos and the Operating Picture. Missing or disconnected measurements are unavailable; demo scenes and qualification model fixtures are explicitly labelled. Cognitive completion never implies a verified effect.

**Current qualification:** this is a working integration with local and disposable-infrastructure evidence, not a hardware-qualified or production-certified assistant. Voice, camera/gesture composition, real provider/account workflows, Android hardware and separate-machine continuity still need qualification. No production deployment or migration is claimed.

Start with [MARK42_SYSTEM_STATUS.md](docs/architecture/MARK42_SYSTEM_STATUS.md) for the current architecture, scenario matrix, truth audit, security limits, performance evidence and exact gate results. [COMPANION_NODES.md](docs/architecture/COMPANION_NODES.md) describes restricted mobile/wall setup. Older RC audit documents are point-in-time evidence, not current certification.

The trusted desktop now has local LiveKit/WebRTC voice transport with local
Windows speech and explicitly selected cloud speech. See [RTC_RUNTIME.md](docs/architecture/RTC_RUNTIME.md)
for setup, privacy boundaries and the distinction between synthetic media tests
and physical microphone qualification.

## Read in this order

1. [`docs/architecture/PRINCIPLES.md`](docs/architecture/PRINCIPLES.md) — the 40 laws
2. [`docs/architecture/MK42_ARCHITECTURE.md`](docs/architecture/MK42_ARCHITECTURE.md) — the whole system in one document
3. [`docs/architecture/KERNEL_CONSTITUTION.md`](docs/architecture/KERNEL_CONSTITUTION.md) — what the Kernel is and is not
4. [`docs/architecture/README.md`](docs/architecture/README.md) — index of every model document
5. [`docs/architecture/GLOSSARY.md`](docs/architecture/GLOSSARY.md) — precise vocabulary

## Structure

| Path | Purpose |
|---|---|
| `apps/` | Implemented runtimes: `core` = Kernel and diagnostics HTTP; `gateway` = Model Gateway; `voice`/`vision` = perception; `desktop` = Next/Tauri shell; `adapter-host`, `labs`, `display` = isolated workers/sandbox/display. `diagnostics` and `relay` are README-only future seams. |
| `packages/` | Real workspace libraries plus explicitly labelled README-only extraction seams. Kernel implementations remain under `apps/core/src/kernel/*`; a folder name alone is not an importable package. |
| `agents/` | Disposable cognitive-worker manifests; the implemented bounded Agent Runtime is in `apps/core/src/kernel/cognition/agent-runtime.ts`. |
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
