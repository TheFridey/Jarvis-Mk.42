# Mark 42 Experience Target — Forge Cosmos

Status: **AUTHORITATIVE TARGET**. This document defines the target experience
boundary. It does not claim that every surface described here is implemented.

## Direction

Forge Cosmos presents JARVIS as an obsidian intelligence environment: near-
black space, graphite panels, metallic-silver structure, forge-gold execution
energy, ember-orange high energy, cyan reasoning/data, green verified state,
amber blocked/degraded state, and red only for critical failure. Visual drama
must improve comprehension without simulating operations that did not occur.

The central JARVIS Core is a GPU-rendered representation of derived live system
state. It is not a control authority, model visualizer, or synthetic activity
generator. If GPU rendering is unavailable, the experience degrades honestly.

## Three separate state axes

**System Mode** is the Kernel-owned operating mode and retains its existing
constitutional meaning. **Interaction State** describes the current human-
system exchange: `DORMANT`, `AWARE`, `LISTENING`, `INTERPRETING`, or `THINKING`.
**Work State** describes tracked work: `ROUTING`, `EXECUTING`, `WAITING`,
`VERIFYING`, `COMPLETE`, `BLOCKED`, or `ERROR`.

The presentation derives a visual composition from all three axes. It must not
rename Interaction or Work State as Kernel mode, infer execution from a model
response, or show `COMPLETE` before authoritative verification evidence.

## Experience Projection

An Experience Projection is a read-only, scoped, versioned projection derived
from canonical events, authoritative PostgreSQL state, health reports, and
ephemeral signals with explicit freshness. It provides presentation-ready
system mode, interaction state, work state, active model/agent/invocation
references, verification state, and only those measured telemetry values that
have real producers.

The Experience Projector is **not a 17th Kernel authority component**. It owns
no authoritative decision, effect, workflow, world model, memory, policy, or
permission state. It cannot execute a capability or write a domain projection.
It is a rebuildable read model and may be discarded and regenerated.

## Truthful model and agent observability

A model may appear active only while a traced Model Gateway request or provider
attempt is active. Provider, model, locality, token usage, cost, latency,
health, failure, and quota fields appear only when emitted by their real
source. Unknown and unavailable are valid states; quotas are never fabricated.

An agent may appear active only from an actual leased/invoked agent run. The
surface distinguishes proposal generation from capability execution. Agent
completion does not imply an effect. Capability execution and verification are
shown from Executor lifecycle evidence, including waiting/blocked/failure.

## Realtime Experience stream

The implemented v1 stream carries channel-scoped Experience Projection updates
over the authenticated WebSocket endpoint `/experience/stream`. Desktop uses
the existing authenticated snapshot as bootstrap and recovery, then applies
duplicate-tolerant, ordered updates. The server provides bounded resume
history, backpressure limits, heartbeat/disconnect detection, and credential
revalidation; stale desktop data is explicitly labelled and commands fail
closed while disconnected.

Canonical events still enter through the Event Manager; PostgreSQL remains
authoritative. The in-process projector owns only ephemeral projection history
and subscriptions. It is neither a command bus nor a second event log. Future
mobile and wall-display clients may consume this same scoped contract after
Node Protocol admission and privacy policy are complete.

## Node Protocol target

Desktop, mobile, display, and future spatial surfaces enroll and authenticate
as nodes, negotiate protocol compatibility, declare actual sensors/outputs,
and receive only policy-scoped projections. Node health and connectivity come
from real protocol evidence. The current Node Protocol is partial; transport
framing, negotiation, and multi-node live proof remain target work.

## Surface targets

- **Desktop:** the primary Tauri Forge Cosmos surface, retaining `SceneGraph`
  and `SceneTransport`; native execution must be verified separately.
- **Mobile:** an owned-node companion for notifications, approvals, voice, and
  scoped status. It is not a remote database client or direct Executor.
- **Display:** an ambient read-mostly node with privacy-aware projection scope;
  it must not imply presence, work, or health without source evidence.
- **ScaleSmiths:** a future capability integration, not a privileged code path.
  Requests pass Policy, Permission, Approval, Executor, and verification, with
  explicit external-system ownership and idempotency.

## Non-negotiable exclusions

There is no Temporal, duplicate workflow authority, second primary database,
second event authority, replacement Scene Graph, replacement ATLAS, or
replacement MNEMOSYNE. The Model Gateway is not authoritative. Frontends do not
mutate authoritative state. Agents do not execute capabilities directly.

## Truthful animation rule

Animation may communicate a transition only while backed by current projection
or trace evidence. Looping ambient motion may express presence of the surface,
but may not claim that a model is thinking, an agent is working, routing is
occurring, an effect is executing, verification is running, hardware is loaded,
or a provider is healthy. Stale evidence visibly ages; missing evidence renders
as unknown, unavailable, or disconnected rather than invented activity.
