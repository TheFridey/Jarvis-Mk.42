# Kernel Constitution

The Kernel is the protected core of JARVIS (L29). This document defines its
**frozen component set**, what each component owns, what it must never depend
on, and the rules for changing it.

Subordinate to [`PRINCIPLES.md`](PRINCIPLES.md). Changing anything in §1–§3
requires an ADR.

---

## 0. What the Kernel is

`apps/core` — one NestJS process, a **modular monolith**. It is:

- the **only** writer of authoritative state (Event Log + Projected State);
- the **only** caller of the Capability Executor;
- the **only** component that renders a policy decision;
- the **only** component that mints authority;
- able to run and make decisions with **zero external network reachability**
  (degraded capability, never corrupted state, never halted core loop).

It is **not**: a model host, a UI host, an agent host (it *supervises* agents
that run as separate processes/workers), or a capability adapter host (adapters
run out-of-process).

## 1. The frozen component set

Exactly these sixteen. Adding, removing, splitting, or merging a component
requires an ADR that shows the change does not violate L5, L6, L7, L8, L10,
L18–L21, L29, L30.

| # | Component | One-sentence responsibility |
|---|---|---|
| 1 | **Identity Manager** | Establishes and verifies *who* a principal, node, or agent-acting-for-principal is; issues identity assertions. Owns the principal and credential-metadata records. |
| 2 | **Session Manager** | Tracks connected Experience-Plane surfaces and their liveness; scopes view subscriptions; mints `correlationId` for Experience-originated interactions. Owns session records. |
| 3 | **Event Manager** | Appends events to the Event Log transactionally, runs the outbox relay to NATS, enforces the envelope schema and event classes. Owns the Event Log. |
| 4 | **State Manager** | Runs projectors that fold events into Projected State read models; serves authoritative read APIs; owns projection checkpoints. Sole writer of Projected State. |
| 5 | **Context Compiler** | Fuses observations + Projected State + World Model queries + Memory recall + active objectives into a budgeted `ContextFrame`; marks unknowns and truncation. Owns no persistent state. |
| 6 | **Presence Manager** | Computes principal/device presence from session liveness + perception observations; owns the node registry (durable) and presence projections. |
| 7 | **Objective Engine** | Owns objectives: their creation, decomposition, success criteria, and status transitions (single writer per objective). Decides *what* should happen and *why*. |
| 8 | **Policy Engine** | Deterministically evaluates `(actor, action, riskClass, context) → ALLOW | DENY | REQUIRE_APPROVAL` from typed rules. No network, no model calls, no side effects. |
| 9 | **Permission Engine** | Owns grants and scopes; mints scoped, TTL'd authority tokens; runs approval and dual-control workflows; enforces the risk→authority tier table. |
| 10 | **Capability Registry** | Owns registered `Capability` manifests and their versions; validates manifests on registration; serves capability lookup. Does not execute. |
| 11 | **Model Registry** | Owns model registrations (declared capabilities, context limits, cost, locality); serves routing metadata to the gateway and Agent Runtime. Holds no credentials. |
| 12 | **Agent Runtime** | Spawns, leases, supervises, and reaps agents as isolated workers; is the component that emits events/observations on validated agent output. Owns agent lease records. |
| 13 | **Scheduler** | Owns timed and triggered work: cron-like schedules, delays, retries, backpressure-aware dispatch. Decides *when*, never *what*. |
| 14 | **Notification Manager** | Owns outbound notification intent and delivery state across surfaces and nodes; respects presence and Do-Not-Disturb policy. |
| 15 | **Health Manager** | Owns component/node/dependency health signals and the degradation state machine; publishes health events that gate routing and approval behaviour. |
| 16 | **Audit Manager** | Derives the append-only audit trail from events; serves audit queries; owns audit projections and retention. Read-only with respect to everything else. |

The Capability **Executor** is a Kernel-internal service *of* the Agency
subsystem, invoked by the flow after Policy+Permission; it is not a
16th top-level component but is equally protected. It is documented in
`AGENCY_MODEL.md`.

**Knowledge Ingestion** is likewise a Kernel-internal protected service of the
knowledge subsystem — the sole writer to `atlas.*` (ATLAS) and `mnemosyne.*`
(MNEMOSYNE). It is not a 17th top-level component. It is documented in
`ATLAS_MODEL.md`, `MNEMOSYNE_MODEL.md`, and `adr/0020-knowledge-subsystem-boundary.md`.

## 2. Kernel-wide forbidden dependencies

No Kernel component may:

1. Import a model provider SDK, or call an inference endpoint directly. All
   inference goes through `apps/gateway` via `ModelRequest` (L1, L3).
2. Import a capability adapter, or perform an adapter's side effect inline.
   Effects go through the Executor (L18).
3. Read or write another component's tables. Cross-component data flows through
   an injected service interface or through events (L5 integrity).
4. Accept authoritative writes from the Experience Plane. Interfaces submit
   `Command`s/`Proposal`s that are validated first (L6).
5. Treat model output, agent output, web content, or external API responses as
   trusted. The Validator sits on every such path (L30).
6. Contain a security control that is only a prompt string (L30).
7. Block its core loop on an external network call. External calls are
   isolated, timed, and circuit-broken; timeout ⇒ degrade (L39).
8. Persist unbounded signal data. Perception observations are *signal events*
   with rolling retention (see `EVENT_ARCHITECTURE.md`).

## 3. Kernel protection mechanisms

- **Process isolation.** Agents, capability adapters, the gateway, and
  perception run as separate OS processes with their own restricted
  credentials. A crash or compromise there cannot mutate Kernel memory or
  Kernel-owned tables.
- **Credential partitioning.** The Kernel holds the database credentials and
  the NATS publish credential for ledger subjects. The gateway holds provider
  API keys and nothing else. Adapters hold only their own scoped resource
  credentials. Agents hold none.
- **Contract-gated ingress.** Every input to the Kernel is a typed contract
  (`Command`, `Proposal`, `Observation`, `NodeDescriptor`, capability result).
  Untyped input is rejected at the edge.
- **Deterministic policy core.** The Policy Engine is a pure function library
  with property tests; it cannot be made non-deterministic by configuration.
- **Immutable component wiring at runtime.** The Nest module graph is fixed at
  build time. Nothing loads Kernel code dynamically. Capabilities, models,
  agents, and nodes are *data* the Kernel reads, never code it links.
- **ADR gate.** §1 and §2 change only through an accepted ADR referencing the
  laws it must not break.

## 4. What may extend the Kernel without an ADR

- New **event types** (new `type` strings + payload schemas), as long as they
  fit an existing event class and an existing component's ownership.
- New **projectors / read models** owned by an existing component.
- New **policy rules** (data), new **capability manifests** (data), new
  **model registrations** (data), new **agent manifests** (data), new **node
  types** (data + protocol version negotiation).
- New **Experience surfaces** consuming existing read APIs.
- New **gateway provider adapters**.

These are the designed extension points. Everything the project needs to grow
for a decade should enter through one of them.

## 5. Kernel lifecycle

- **Cold start.** Load config → connect PostgreSQL → replay Event Log from the
  last projection checkpoint to rebuild Projected State → discard and rebuild
  Ephemeral State from live re-connections and node re-registration → connect
  NATS → resume the outbox relay → open ingress. The core decision loop is
  available before NATS/gateway if those are down (degraded).
- **Restart safety.** Every in-flight capability execution is recoverable: a
  `capability.started` with no terminal event triggers declared compensation on
  restart (`AGENCY_MODEL.md`).
- **Shutdown.** Stop ingress → drain the Scheduler and Agent Runtime leases →
  flush the outbox → checkpoint projections → close.

## 6. Relationship to the other planes

| Plane | Kernel's stance |
|---|---|
| Experience | Serves it read-only views and notifications; accepts only validated commands/proposals from it. |
| Perception | Consumes its observation events; never sends it reasoning work; may configure its sensors via capability. |
| Cognition | Sends it `ContextFrame`s; receives `Proposal`s as untrusted input; owns the gateway *process boundary* but not the models. |
| Agency | Owns the Executor; invokes adapters out-of-process under policy+permission; consumes their result+verification events. |
| Data | Sole authoritative writer to PostgreSQL; uses Redis for ephemeral only; publishes/consumes NATS. |
| Infrastructure | Runs as a node (the local server) among nodes; discovers and admits other nodes via the Node Protocol. |
