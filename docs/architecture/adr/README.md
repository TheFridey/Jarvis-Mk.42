# Architecture Decision Records

One record per significant decision. Each is immutable once accepted; a
superseding decision gets a new ADR that references the old one.

## Template

```
# ADR-NNNN: <title>

Status: Proposed | Accepted | Superseded by ADR-XXXX
Date: YYYY-MM-DD
Deciders: Principal Architect

## Context
What forces are at play; what problem must be solved; which laws (PRINCIPLES.md) constrain it.

## Decision
The choice, stated plainly.

## Alternatives considered
Each with a one-line reason it lost.

## Benefits
## Disadvantages
## Risks
## Consequences
What now becomes true / required / forbidden as a result.

## Reversal difficulty
Trivial | Low | Moderate | High | Severe — and what a reversal would cost.
```

## Index

| ADR | Title | Status | Reversal |
|---|---|---|---|
| [0001](0001-nestjs.md) | NestJS for the Kernel | Accepted | Moderate |
| [0002](0002-postgresql.md) | PostgreSQL as authoritative store | Accepted | Severe |
| [0003](0003-drizzle.md) | Drizzle ORM | Accepted | Low |
| [0004](0004-redis.md) | Redis for ephemeral state | Accepted | Low |
| [0005](0005-nats-jetstream.md) | NATS JetStream as event transport | Accepted | Moderate |
| [0006](0006-tauri.md) | Tauri for the desktop shell | Accepted | Low |
| [0007](0007-monorepo-pnpm.md) | pnpm monorepo | Accepted | Low |
| [0008](0008-modular-monolith.md) | Modular monolith for the Kernel | Accepted | Moderate |
| [0009](0009-event-architecture.md) | Event-sourced core + outbox + selective sourcing | Accepted | High |
| [0010](0010-model-gateway.md) | Model Gateway as sole inference egress | Accepted | Low |
| [0011](0011-pgvector.md) | pgvector for embeddings | Accepted | Low |
| [0012](0012-livekit-webrtc.md) | LiveKit/WebRTC direction (deferred) | Accepted | Low |
| [0013](0013-object-storage.md) | S3-compatible object storage (MinIO) | Accepted | Low |
| [0014](0014-local-cloud-computation.md) | Local-first compute, cloud as resource | Accepted | Moderate |
| [0015](0015-scene-graph.md) | Scene Graph as the shared spatial abstraction | Accepted | Low |
| [0016](0016-capability-architecture.md) | Capability manifests + single Executor | Accepted | High |
| [0017](0017-authoritative-state-ownership.md) | Single authoritative state, Kernel-owned | Accepted | Severe |
| [0018](0018-structural-injection-defense.md) | Structural (not prompt) prompt-injection defense | Accepted | High |
| [0019](0019-operating-modes.md) | JARVIS operating modes (7-mode state machine) | Accepted | Low |
| [0020](0020-knowledge-subsystem-boundary.md) | Knowledge subsystem boundary (ATLAS / MNEMOSYNE) | Accepted | Moderate |
