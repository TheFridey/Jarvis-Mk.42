# System Boundaries

Every module boundary in MK.42: what each unit does, what it owns, what it may
depend on, what it must never do, and — for in-process modules — the seam at
which it becomes a service later without redesign.

Subordinate to [`PRINCIPLES.md`](PRINCIPLES.md) and
[`KERNEL_CONSTITUTION.md`](KERNEL_CONSTITUTION.md).

A boundary is healthy when: you can state what the unit does without reading
its internals; you can change its internals without breaking consumers; it
communicates only through contracts and events.

---

## 1. Deployable processes in MK.42

| Process | Repo path | Node | Lifecycle rationale for separation |
|---|---|---|---|
| Kernel | `apps/core` | local server | — (the monolith) |
| Model Gateway | `apps/gateway` | local server | Holds provider API keys; slow, failure-prone network IO; must restart independently of the Kernel (L26, blast radius). |
| Voice perception | `apps/voice` | workstation | Realtime audio loop; must not be blocked by Kernel GC; crash-isolated; raw audio stays local (L25, L27). |
| Vision perception | `apps/vision` | workstation | Realtime video loop; GPU/native deps; raw frames stay local (L27). |
| Desktop shell | `apps/desktop` | workstation | Tauri; user-session lifecycle; pure Experience Plane. |
| Diagnostics | `apps/diagnostics` | workstation | Operator read-only UI over Kernel APIs; independent deploy so it can inspect a sick Kernel. |
| Relay (future) | `apps/relay` | edge | Empty in MK.42. Documented seam for node-facing edge termination when nodes live off-LAN. |
| Adapter Host | `apps/adapter-host` | local server + workstation | Agency worker runtime (HEPHAESTUS, ADR-0025): one zero-environment Node worker per capability invocation; per-invocation credential handle; typed IPC to the Executor only; no store credential. Isolates a compromised adapter to one scoped, short-lived invocation. |
| JARVIS LABS | `apps/labs` | local server | Isolated experimentation sandbox (HEPHAESTUS, ADR-0029): ephemeral Docker, synthetic credentials, mock APIs, throwaway PG + scratch FS, default-deny network, resource limits, guaranteed teardown. FORGE builds/tests capability drafts here; no route to real Kernel infra; promotion is human-reviewed and operator-gated. |

Everything else is an **in-process Nest module** inside `apps/core`, or a
**library** in `packages/*`, or an **out-of-process adapter/worker** spawned on
demand (capability adapters, agents).

## 2. Experience Plane boundary

**Does.** Renders JARVIS state to the principal across surfaces; captures
principal input (text, voice intent from the voice process, gestures, UI
actions); subscribes to scoped read models and notifications.

**Owns.** View state, layout, local UI preferences, unsent input drafts,
per-surface session tokens. Nothing authoritative (L6).

**May depend on.** Kernel read APIs (`packages/sdk`), the Notification stream,
the voice process for local capture. `packages/scene` for spatial UI.

**Must never.** Write any authoritative store. Call a capability adapter
directly. Call a model directly. Hold provider or database credentials. Embed
policy logic (it may *reflect* policy state to the user, not enforce it).

**Inbound to Kernel.** `Command` (do this) and `Proposal` (I think we should)
envelopes over WebSocket, authenticated per surface, validated by the
Validator, then handled by Session Manager → relevant component.

**Seam.** Already a network boundary. New surfaces (mobile, AR) are new
clients of the same SDK + Node Protocol.

## 3. Kernel module boundaries

The 16 components (`KERNEL_CONSTITUTION.md` §1) are Nest modules. Rules:

- A module exposes a **service interface** (TypeScript `interface` in
  `packages/contracts` or a local `*.port.ts`) and an **event contribution**
  (the event types it emits). Consumers use one of those two, never the
  module's repository/tables.
- Dependency direction: `ingress (Identity, Session)` → `sense-making (Context,
  Presence)` → `intent (Objective)` → `authority (Policy, Permission)` →
  `catalogues (Capability, Model)` → `orchestration (Agent Runtime, Scheduler,
  Notification, Health)`. The **spine** (Event, State, Audit) is depended on by
  all and depends on none of them.
- No cycles. If module A needs something from a module "downstream" of it, it
  emits an event and the downstream module reacts.

**Per-module extraction seam.** Each Kernel module can be lifted into its own
process by replacing its in-process service interface binding with a
NATS-request/JetStream binding — because it already only receives contracts and
events. `DATA_OWNERSHIP.md` lists which PostgreSQL schema goes with it.

## 4. Perception Plane boundary

**Does.** Turns sensors into `Observation` events: wake detection, ASR,
vision (hands, pose, presence, object/person detection), screen/app/cursor
telemetry, environmental sensors, digital telemetry.

**Owns.** Sensor device handles, local models for perception inference,
debounce/aggregation buffers, a short local spool for observations if NATS is
briefly unreachable. No authoritative state.

**May depend on.** `packages/contracts` (Observation, Event), the NATS client,
local ML runtimes (ONNX Runtime, MediaPipe, whisper.cpp, etc.), `packages/
telemetry`.

**Must never.** Import the Model Gateway client or `packages/agents` or any
Cognition package (L7). Write the World Model or Memory (L8). Draw conclusions
("the user is angry") — it may emit low-level signals ("prosody.arousal=high,
confidence 0.6") and let cognition interpret. Transmit raw audio/video
off-host (L27) except via an explicit HIGH-risk capability.

**Outbound.** `jarvis.perception.<domain>.<name>` events onto NATS, consumed
by the Context Compiler and World Model ingestion.

**Seam.** Already separate processes. A new sensor is a new observation type.
A GPU node running heavier perception is a new node publishing the same
observation types.

## 5. Cognition Plane boundary

### 5.1 Model Gateway (`apps/gateway`)

**Does.** Accepts provider-neutral `ModelRequest`; selects a model using
Model Registry metadata + routing policy (capability match, cost, latency,
`locality` constraint, health); serialises the request to the chosen
provider's wire format via an adapter; returns `ModelResponse`; emits
`jarvis.cognition.model.called` with cost/latency/tokens (no payload content by
default).

**Owns.** Provider API credentials, per-provider rate-limit and circuit-breaker
state, response cache (keyed on request hash, TTL, opt-in per request).

**May depend on.** Model Registry (read), `packages/models` contracts,
`packages/telemetry`. Provider SDKs — **this is the only place they are
allowed**.

**Must never.** Write authoritative state. Make policy decisions. Persist
prompt/response content beyond the opt-in cache and its TTL. Be on the Kernel's
critical path such that its outage halts the Kernel (calls are timed +
circuit-broken; `FAILURE_MODEL.md`).

**Seam.** Already a separate process reached by NATS request/reply. Splitting
per-provider gateways later is a routing change.

### 5.2 Reasoning / planning / synthesis (`packages/*` used by Agent Runtime)

**Does.** Consume `ContextFrame`, produce `Proposal` (answer, plan, draft,
`PolicyRecommendation`, suggested capability invocation).

**Owns.** Nothing persistent. Working scratch within a task lease.

**Must never.** Hold credentials. Cause effects. Emit events directly (returns
to Agent Runtime, which emits after validation — see review §16.7). Write World
Model / Memory.

### 5.3 Agents (`agents/*`)

**Does.** A scoped cognitive job (research = `scout`, coding = `forge`,
analysis = `atlas`, …). Runs as an isolated worker under an Agent Runtime
lease with a scoped `ContextFrame` and a capped budget.

**Owns.** Ephemeral task workspace (a temp dir, provided via
`capabilities/filesystem` workspace scope). Nothing else.

**Must never.** Persist across its lease. Own system state (L10). Hold DB/NATS/
provider credentials. Call capabilities directly — it *proposes* invocations
that the Executor gates. Spawn its own sub-agents except through the Agent
Runtime.

**Seam.** Agents are already isolated workers; running them on a separate
worker node is a scheduling change.

## 6. Agency Plane boundary

**Does.** Executes effects in the world through capability adapters:
`browser`, `windows`, `filesystem`, `terminal`, `github`, `docker`, `web`,
`scalesmiths`, `smart-home` (future), robotics (future).

**Owns.** Per-capability resource credentials (a GitHub token scoped to
declared repos, a Docker socket handle, a filesystem workspace root). The
adapter process owns nothing authoritative.

**May depend on.** `packages/capabilities` contracts, the Executor's
invocation channel, its own resource SDKs.

**Must never.** Be invoked except through the Executor after Policy+Permission
(L18). Escalate its own scope. Skip `verify`. Perform real side effects during
`simulate`. Emit ledger events directly (the Executor emits results).

**Seam.** Adapters are already out-of-process, spawned per invocation or
pooled. Moving an adapter to the node where its resource lives (e.g. a
`windows` adapter on each workstation) is a placement change; the manifest and
Executor contract are unchanged.

## 7. World Model & Memory boundary

### 7.1 World Model (`packages/world-model`)

**Does.** Stores and serves entities, relationships, and `Fact`s with
mandatory provenance/confidence/epistemic status and optional temporal
validity; maintains the evidence graph; performs belief revision (supersede via
temporal validity, record conflicts). Domains include ScaleSmiths as a
first-class business entity graph.

**Owns.** PostgreSQL `world_model` schema (`entities`,
`entity_relationships`, `facts`, `facts_archive`, `evidence`, `observations`
index).

**Writers.** Kernel ingestion only — from perception observations and from
**validated** cognition output. No agent, no interface, no perception process
writes it directly.

**Readers.** Context Compiler, cognition (via a query API), diagnostics.

**Must never.** Store episodic transcripts (those are Memory). Accept a fact
without provenance/confidence (contract-enforced). Silently overwrite a
conflicting fact.

**Seam.** Query API is already a service interface; becomes a service by
swapping the binding.

### 7.2 Memory (`packages/memory`)

**Does.** Stores episodes (conversations, action outcomes, notable event
sequences), rolling summaries, and embeddings; serves `top-k` recall with a
relevance floor; runs summarisation/decay compaction.

**Owns.** PostgreSQL `memory` schema + pgvector indexes; object-storage refs
for large artefacts.

**Writers.** Kernel memory service only (from events + session/objective
outcomes).

**Readers.** Context Compiler, cognition (recall API), diagnostics.

**Must never.** Be treated as authoritative truth. Be queried without a
`top-k` + floor bound (review §16.12).

## 8. Data Plane boundary

| Store | Authority for | Never used for |
|---|---|---|
| PostgreSQL | Event Log, Projected State, World Model, Memory, Audit — everything authoritative | Transport; ephemeral counters |
| pgvector (in PostgreSQL) | Similarity indexes for Memory recall and fact/entity resolution | Authoritative truth by itself |
| Redis | Ephemeral: presence/liveness, locks/leases, caches, rate limits, UI pub/sub | Anything that must survive its restart |
| NATS JetStream | Event transport, fan-out, replay buffer, backpressure | System of record (PostgreSQL is) |
| Object storage (MinIO) | Blobs: screenshots, audio/video clips, model artefacts, agent work-products, exports | Structured queryable state |
| OTel collector | Traces, metrics, logs | Business state |

Only the Kernel writes PostgreSQL authoritative schemas. Perception/gateway/
adapters/agents interact with data **only** by emitting events or calling
Kernel service interfaces — never direct cross-domain DB access (this is an
explicit hostility of the constitution).

## 9. Infrastructure Plane boundary

**MK.42.** Two nodes, Docker Compose:

- **Workstation node** — Tauri shell, voice, vision, diagnostics, `windows`
  adapter. Trust tier `owned-secure`.
- **Local server node** — Kernel, gateway, PostgreSQL, Redis, NATS, MinIO,
  OTel. Trust tier `kernel-local`.

Cloud: frontier model APIs only, reached from the gateway. No JARVIS
authoritative component runs in cloud in MK.42.

**Seam.** GPU node, phone, display, AR headset, robot each attach via the Node
Protocol (`docs/protocols/node-protocol.md`) with a declared trust tier,
sensor set, and capability set. The Kernel admits them without code change
(`KERNEL_CONSTITUTION.md` §4).

## 10. Extraction order (if/when the monolith must split)

Documented so a future split is deliberate, not reactive. Recommended order,
highest independent value first:

1. **World Model + Memory** → a read-heavy "knowledge service" (already
   query-API only).
2. **Agent Runtime** → an "orchestration service" on a worker node.
3. **Context Compiler** → co-locate with knowledge service (they chat a lot).
4. **Objective / Scheduler** → a "planning service".
5. The **spine** (Event, State, Audit) stays as the Kernel core; it is the
   thing everything else is a client of. It is the last to move and probably
   never should.

Each step: replace the in-process binding with NATS request/reply + its own
PostgreSQL schema connection, deploy, cut over behind Health-Manager routing.
No consumer code changes because consumers already used contracts and events.
