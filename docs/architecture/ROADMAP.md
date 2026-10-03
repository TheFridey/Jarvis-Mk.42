# JARVIS roadmap and implementation status

This document separates historical MK lineage from current repository truth.
MK numbers describe architecture lineage and capability waves; they are not
product releases. Product/build semantics are defined in
[`VERSIONING.md`](./VERSIONING.md).

Status words are evidence-bearing:

- **VERIFIED** — implementation and its required repository gates have passed.
- **IMPLEMENTED BUT NOT HARDWARE-VERIFIED** — code and automated tests exist,
  but the named physical device/provider/network path was not exercised.
- **PARTIAL** — a coherent subset exists; listed gaps remain.
- **PLANNED** — accepted direction without implementing runtime code.
- **DEFERRED** — intentionally outside the current release target.

Historical plans and ADRs remain useful records, but do not outrank code,
migrations, tests, and the latest audit evidence.

## Frozen invariant

JARVIS remains a modular monolith. PostgreSQL is authoritative. Durable events
flow through the Event Manager and transactional outbox to JetStream. Models
reason, agents propose, the Kernel decides, the Executor acts, and verification
determines whether an effect occurred. Interfaces and perception do not own or
mutate authoritative state.

The Kernel constitution freezes 16 authority components. A read-only derived
projection, adapter, client, or presentation service does not become another
Kernel authority component.

## Current truth at RC1.2

| System | Status | Current repository evidence and boundary |
|---|---|---|
| Kernel composition and lifecycle | **VERIFIED** | `apps/core/src/kernel/lifecycle`; restart, health, and lifecycle integration coverage. |
| PostgreSQL authoritative state and migrations | **VERIFIED** | `packages/persistence`; forward-only migrations `0001`–`0015`; event/state/agency/cognition/ATLAS/MNEMOSYNE schemas and Runtime-owned agent jobs. |
| Event Manager, transactional outbox, JetStream | **VERIFIED** | Durable append/outbox, idempotency, DLQ, topology, outage and recovery audit. PostgreSQL remains authority. |
| Redis ephemeral state | **VERIFIED** | Optional ephemeral cache/presence behavior; never authority. |
| Policy, Permission, Approval | **VERIFIED** | Fail-closed policy and grant/approval/token paths with unit, integration, security, and fitness gates. |
| Capability Registry and Executor | **VERIFIED** | Durable invocation lifecycle, isolated adapter host, simulate/execute/verify/rollback gates. This does not certify every external adapter target. |
| Agency Plane | **PARTIAL** | Load-bearing core is wired; the full historical HEPHAESTUS breadth and every external integration are not certified. |
| Context Compiler | **VERIFIED** | Bounded ranked fusion of Kernel state, events, ATLAS, and MNEMOSYNE with privacy-aware routing. |
| Model Registry and Model Gateway | **PARTIAL** | Routing, adapters, budgets, circuit breakers, tracing, and tests exist. Live provider credentials, quotas, latency, and availability are environment-dependent and not certified here. |
| Cognition Observatory / Model Rail | **PARTIAL** | Actual provider-attempt/fallback observations, rejection reasoning, state-driven route diagram, health/circuit metadata, separate usage dimensions and realtime projection exist. Live providers are unverified; first-token streaming, session aggregation, standby catalogue and spatial choreography remain incomplete. Quotas and local GPU/VRAM/queue metrics are unavailable unless genuinely supplied. |
| Agent Runtime / Agent Observatory | **IMPLEMENTED BUT NOT HARDWARE-VERIFIED** | Runtime-owned PostgreSQL job/lease history (0015), fenced recovery, event-driven bounded queue, credentialless fixed-process workers, eleven manifests, scoped proposals, authenticated cancellation and effect-linked realtime Observatory. Restart recovery uses trusted identity-bound resubmission and fresh Context compilation. No hostile-code/plugin sandbox, live-provider or native UI certification is claimed. Current gate evidence: Prompt 6 audit; authority/recovery decision: ADR 0040. |
| ATLAS temporal world model | **VERIFIED** | PostgreSQL-backed temporal facts, conflicts, provenance, queries, and ingestion ownership. |
| MNEMOSYNE memory | **VERIFIED** | Candidate gate, recall, consolidation proposals, and PostgreSQL persistence. It is not authoritative truth. |
| Objective Engine and Scheduler | **VERIFIED** | Durable objective ownership, scheduling, and restart behavior exist in the Kernel. |
| Notification, Health, Audit/diagnostics | **VERIFIED** | Real derived reports and health transitions; no fabricated provider/hardware metrics. |
| Scene Graph and spatial desktop | **VERIFIED** | Semantic scene state and browser desktop build/tests; presentation remains behind `SceneTransport`. |
| Experience Projection and realtime desktop stream | **VERIFIED** | Typed read-only operating picture, authenticated scoped WebSocket updates, bounded resume/backpressure, heartbeat/revocation, and honest stale-state client behavior. Snapshot remains bootstrap/recovery. |
| Forge Cosmos GPU renderer and Core V2 | **IMPLEMENTED BUT NOT HARDWARE-VERIFIED** | WebGL React Three Fiber environment consumes `@jarvis/scene`; its layered state-derived Core retains accessible DOM text, accepts bounded derived audio envelopes, offers opt-in transition sounds, and supports measured AUTO quality, reduced-motion/low-power/hidden-window budgets and a no-WebGL fallback. Workstation, audio-device, integrated-GPU, and native Tauri performance remain unverified. |
| Tauri native desktop shell | **IMPLEMENTED BUT NOT HARDWARE-VERIFIED** | Tauri project and web build exist; native Rust compilation/device execution is not part of current evidence. |
| Voice subsystem | **PARTIAL** | Authenticated typed ingress and Kernel integration exist; microphone/wake/ASR hardware path is not certified. |
| Vision and Air Touch | **IMPLEMENTED BUT NOT HARDWARE-VERIFIED** | Local MediaPipe pipeline, typed privacy boundary, screen probe, and tests exist; webcam acquisition remains unverified. |
| Node Protocol | **PARTIAL** | Contracts, enrollment, credentials, trust lifecycle, and stores exist. Complete transport framing/negotiation and multi-node live proof remain planned. |
| OpenTelemetry | **PARTIAL** | Real SDK/export, inbound interaction, context, model, agent, capability, event/outbox, useful PostgreSQL boundary spans, trace propagation, and undici instrumentation exist. The complete metrics catalogue and every process/path remain incomplete. |
| Back-up and restore | **VERIFIED** | Mandatory repository drill exercises real `pg_dump`/`pg_restore`. Off-host operational recovery is environment-specific. |
| Mobile/display nodes | **PLANNED** | Must consume scoped projections and register through Node Protocol. |
| ScaleSmiths capability integration | **PLANNED** | Must enter through registered capabilities, policy, permission, approval, Executor, and verification. |
| LiveKit, AR, robotics, multi-user delegation | **DEFERRED** | Retained as future directions; no current-runtime claim. |

## Historical MK lineage

The lineage is architectural history, not a queue of wholly unbuilt releases:

- **MK.42 — Genesis:** constitution, boundaries, contracts, and original
  skeleton. Historical phrase “no runtime” describes the starting point only.
- **MK.43 — Spine:** Kernel, authoritative persistence, event fabric, state,
  audit/diagnostics. Shipped and verified in the current modular monolith.
- **MK.44 — Authority:** policy, permission, approval, registry, and Executor.
  The load-bearing core shipped; historical HEPHAESTUS breadth remains partial.
- **MK.45 — Cognition:** Context Compiler, model registry/gateway, proposals,
  and agent runtime shipped. Live providers remain deployment evidence.
- **MK.46 — Knowledge:** ATLAS and MNEMOSYNE shipped in the Kernel modular
  monolith, despite old README-only extraction package diagrams.
- **MK.47 — Perception:** voice/vision/screen foundations shipped; physical
  microphone/webcam validation remains environment-specific.
- **MK.48 — Objectives:** objective, scheduler, notification, and health
  foundations shipped.
- **MK.49 — Experience:** Scene Graph and web desktop shipped; native Tauri
  hardware/runtime proof remains outstanding.
- **MK.50 — Agency breadth:** core agency mechanisms and several adapters
  shipped; broad external integrations are not all live-certified.
- **MK.51+ — Spatial and multi-node:** partial Node Protocol foundation;
  additional nodes and remote media remain planned.
- **MK.60+ / MK.70+ / MK.80+ / MK.90+:** GPU-node, AR, robotics, and multi-user
  directions are deferred until real requirements and verification exist.

## Extension seams

New providers enter through Model Gateway adapters and Model Registry rows. New
effects enter as registered capability manifests plus isolated adapters. New
agents remain proposal-only. New sensors emit typed observations. New surfaces
consume scoped derived projections and submit validated commands. None may
create a second authority, database, workflow engine, world model, memory
system, or direct effect path.

## Explicit anti-targets

- No Temporal or competing workflow authority.
- No microservice split for aesthetics and no NestJS rewrite by implication.
- No direct agent/frontend/provider mutation of authoritative state.
- No provider name in Kernel contracts and no credential in model metadata.
- No fake activity, quotas, cost, telemetry, hardware state, or animation.
- No unbounded persistence and no weakening forward-only migration history.
