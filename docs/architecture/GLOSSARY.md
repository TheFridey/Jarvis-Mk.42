# MK.42 Glossary

Precise vocabulary. If a word appears in the architecture docs, it means what
it says here and nothing else. Ambiguity in these terms is an architectural
defect.

---

## Core identity

**JARVIS** — the persistent operating layer: identity, state, events, context,
memory, world model, objectives, policy, permission, capability management,
model routing, agent orchestration, perception, spatial intelligence,
planning, simulation, execution, verification, audit, interfaces, nodes. Not
any model.

**Kernel** — the protected core process (`apps/core`) containing the frozen set
of Kernel components. Extends only via ADR. See `KERNEL_CONSTITUTION.md`.

**Principal** — an authenticated human (or, later, autonomous) identity on
whose behalf JARVIS acts. MK.42 has one. Every authoritative record is
`principalId`-scoped.

**Operator** — the principal in their administrative role: manages nodes,
policy, capabilities, health. In MK.42 the operator and the principal are the
same person; the roles are distinct in the model.

## State

**Event** — an immutable record that something happened, in the canonical
`Event` envelope. The atom of the system.

**Event Log** — the append-only, ordered store of all events (PostgreSQL
`events` table). Source of truth for history. Never mutated.

**Projected State** — materialised read models derived from the Event Log,
holding *current* authoritative values (objective status, active grants,
registered capabilities/models, node registry). PostgreSQL. Owned by the State
Manager.

**Ephemeral Runtime State** — reconstructible operational state: presence,
session liveness, locks, caches, rate-limit counters. Redis + in-memory.
Never authoritative. Loss degrades, never corrupts.

**Command** — a request submitted to the Kernel to change state or cause an
effect. Validated, may be rejected. Not itself authoritative until it produces
events.

**Projection** — the process (and result) of folding events into a read model.

**Outbox** — the transactional pattern by which an event is written to
PostgreSQL in the same transaction as a state change, then relayed to NATS.

**retentionClass** — the storage policy stamped on every event at append time
(ADR-0009 Amendment 1): one of `TRANSIENT` (bus only, not persisted),
`OPERATIONAL` (90 d), `AUDIT` (indefinite, tamper-evident), `MEMORY_CANDIDATE`
(until consolidated), `SECURITY` (indefinite, tamper-evident), `DIAGNOSTIC`
(14 d). Immutable after append; elevate by re-emitting.

**privacyClass** — the confidentiality band on every event: `PUBLIC`,
`INTERNAL`, `SENSITIVE`, `RESTRICTED`. Drives Context Compiler filtering and
cross-node propagation. `RESTRICTED` never leaves its origin node without a
HIGH-risk capability.

**JarvisMode** — the system's operating posture (ADR-0019): `DORMANT`,
`AMBIENT`, `ENGAGED`, `FOCUSED`, `AUTONOMOUS`, `GUARDIAN`, `DEGRADED`. A
versioned facet of authoritative state owned by the State Manager, changed only
via the deterministic transition table. A posture, never an authority bypass —
mode may *strengthen* a policy decision (e.g. `GUARDIAN`) but never weaken one.

**JarvisMode.FOCUSED** vs **PresenceState.FOCUSED** — distinct. `JarvisMode.
FOCUSED` is JARVIS's posture (proactivity suppressed, only urgent notifications
pass). `PresenceState.FOCUSED` is an *observation* about the user (deeply
engaged with a workspace, from keyboard/app-focus evidence). One often triggers
a transition to the other, but they are separate values in separate domains.

**Replay ≠ re-execution** — replaying events rebuilds read models (pure
projectors only); it never re-runs side effects. Enforced by a dedicated
`ReplayBus` that only projector consumers may subscribe to, plus a
`meta.replay=true` tag that effect-causing consumers reject.

## Epistemics

**Observation** — a perception-produced record of something sensed
(`asr.transcript`, `vision.person.present`, `screen.window.focused`). Carries
`EpistemicStatus = observed`. Never a conclusion.

**Fact** — a structured belief in the World Model: a typed attribute or
subject–predicate–object statement, with mandatory `provenance`, `confidence`,
`epistemicStatus`, and optional `validFrom`/`validTo`.

**Provenance** — the origin of a fact or observation: which sensor, which
model, which source document, which principal assertion, which inference run.

**Confidence** — a 0..1 scalar expressing how strongly a fact is held.

**Temporal validity** — the `[validFrom, validTo)` window during which a fact is
considered true.

**EpistemicStatus** — one of: `observed` (sensed directly), `asserted` (stated
by a principal), `retrieved` (fetched from an external source), `inferred`
(deduced by reasoning), `predicted` (forecast about the future), `derived`
(computed from other facts by a deterministic function).

**Evidence** — the link set connecting a fact to the observations, sources, or
parent facts supporting it. Makes belief traversable (L15).

**Belief revision** — replacing or superseding facts as new information
arrives, via temporal validity and recorded conflicts — never silent
overwrite.

## Memory vs World Model

**World Model** — the current, structured, provenance-bearing model of
entities and their state: people, places, projects, devices, software,
infrastructure, businesses (including ScaleSmiths), and their relationships.
Answers "what is true now, and why". `packages/world-model`.

**Memory** — the experiential record: episodes (conversations, action
outcomes, events lived through), summaries, and embeddings for recall. Answers
"what past experience is relevant to the current context". Append-mostly,
lossy-compressible. `packages/memory`.

**Entity** — a thing the World Model tracks, with a stable id, a type, and
optional spatial extent.

**Episode** — a bounded slice of experience stored in Memory, with time
bounds, participants, and a link back to its source events.

**ATLAS** — the implemented name for the temporal World Model subsystem (MK.46).
Schema `atlas`. Not to be confused with the `atlas` agent (data analysis) —
capitalised ATLAS is the subsystem, lower-case `atlas` is a disposable worker.

**MNEMOSYNE** — the implemented name for the Memory subsystem (MK.46). Schema
`mnemosyne`. Not to be confused with the `mnemosyne` agent (memory curation) —
capitalised MNEMOSYNE is the subsystem, lower-case `mnemosyne` is a disposable
worker.

**Knowledge Ingestion** — the Kernel-internal protected service that is the sole
writer to `atlas.*` and `mnemosyne.*` (ADR-0020). Executor-class: protected, not
one of the frozen 16.

**RelationKind** — the four-rung ladder for `atlas.causal_hypotheses`:
`chronological` < `correlated` < `hypothesised_cause` < `established_cause`.
Cognition may propose at most `hypothesised_cause` (ADR-0021).

**MemoryClass** — one of `episodic`, `semantic`, `procedural`, `preference` (the
four durable, schema-backed MNEMOSYNE classes). `working` / `session` / `spatial`
memory are pointers to other Kernel owners; `entity memory` is a query.

**Memory Candidate** — a scored, not-yet-accepted item in
`mnemosyne.candidates`. Disposition: `accepted | merged | rejected | expired |
deferred`. Nothing becomes an Episode without passing this gate.

**DREAMING** — the internal nickname for MNEMOSYNE's scheduled offline
consolidation routine (ADR-0022). Knowledge consolidation, not consciousness.
Emits proposals only.

**Morning Insight** — MNEMOSYNE surfacing "I noticed something overnight" via the
Notification Manager, only for real, evidence-backed, threshold-significant,
context-relevant, not-already-surfaced insights.

## Cognition

**Model Gateway** — the single egress point to all inference providers
(`apps/gateway`). Holds provider credentials. Routes `ModelRequest`s by
capability, cost, latency, and locality. The only component that talks to
OpenAI / Anthropic / Gemini / local inference.

**Model Registry** — the Kernel catalogue of available models and their
declared capabilities, costs, context limits, and locality. Owned by the Model
Registry component.

**Cognition** — reasoning, planning, synthesis, analysis. Consumes
`ContextFrame`s, produces `Proposal`s. Holds no credentials, causes no
effects.

**Context Compiler** — the Kernel component that fuses observations, projected
state, world-model queries, memory recall, and active objectives into a
bounded `ContextFrame` for a cognition task.

**ContextFrame** — the bounded, budgeted input assembled for one cognition
task. Explicitly marks unknowns (L17).

**Proposal** — typed cognition output: an answer, a plan, a draft, a policy
recommendation, a suggested capability invocation. Untrusted until validated.
Never an effect.

**Agent** — a disposable worker orchestrated by the Agent Runtime to perform a
scoped cognitive job (research, coding, analysis). Leased, sandboxed,
stateless with respect to system state. Named roster in `agents/`.

**Agent Runtime** — the Kernel component that spawns, leases, supervises, and
reaps agents.

## Action

**Capability** — a declared, versioned contract for a class of effects, with
`actions`, input/output schemas, `riskClass`, `reversible`/`rollback`,
`simulate`, `verify`, and `requiredScopes`. `capabilities/` holds manifests;
adapters run out-of-process.

**Capability Registry** — the Kernel catalogue of registered capability
manifests. Owned by the Capability Registry component.

**Capability Executor** — the single pipeline through which every effect runs:
policy check → simulate (if required) → acquire authority → execute → verify →
emit result → rollback on failure.

**Adapter** — the out-of-process implementation of a capability (browser,
terminal, filesystem, GitHub, Docker, ScaleSmiths, …).

**Policy Engine** — the deterministic rule evaluator producing
`ALLOW | DENY | REQUIRE_APPROVAL` from `(actor, action, riskClass, context)`.
No network, no model calls.

**Permission Engine** — manages grants, scopes, TTL'd authority tokens,
elevation, and approval workflows. Enforces the risk→authority tier table.

**Grant** — a scoped, possibly time-boxed authorisation for a principal (or
agent acting for a principal) to invoke capabilities within named scopes.

**Authority tier** — the strength-of-authorisation level required for a
`riskClass` (e.g. AMBIENT, STANDARD, ELEVATED, CONFIRMED, DUAL). Defined in
`SECURITY_MODEL.md`.

**Verification** — the mandatory post-execution check that an action actually
produced its intended effect (L22).

**Simulation** — a dry run of a dangerous action producing a predicted effect
for approval, with no real side effects (L24).

**Action lifecycle** — the 14-state machine the Capability Executor runs each
invocation through (`PROPOSED → VALIDATED → POLICY_CHECKED → …AWAITING_APPROVAL
→ APPROVED → SIMULATING → EXECUTING → VERIFYING → COMPLETED`, plus `REJECTED /
DENIED / ABORTED / FAILED / VERIFICATION_FAILED / ROLLING_BACK → ROLLED_BACK /
COMPENSATING → PARTIALLY_COMPLETED`). Owned by the Executor as
`agency.invocations`, folded from `jarvis.agency.invocation.*` events (ADR-0025).

**Freshness barrier** — the Executor's re-read of `grant.version` /
`revoked_at` **inside** the transaction that writes the `EXECUTING` row and
appends `capability.started`; a stale or revoked grant ⇒ `ABORTED`, no
credential minted (ADR-0027).

**Credential Broker** — the only process holding adapter credential *material*
(in memory, from the OS keychain / a `0600` file). Exposes only
`mint(invocationId, …) → CredentialHandle`; mints `derived` short-lived tokens
where a backend supports it, else `wrapped-static`; `dry-run` mode yields a
read-only credential (ADR-0025 §2).

**Credential handle** — a per-invocation, single-use, TTL'd reference an
adapter worker uses to act; for `derived` mints the worker never sees the
secret string.

**Adapter Host** — `apps/adapter-host`; the out-of-process worker runtime the
Executor drives. Spawns a fresh zero-environment Node worker per invocation for
`riskClass >= MEDIUM` (pool allowed for cheap reads); `worker+container` runs
the worker inside a fresh restricted container.

**Capability SDK** — `@jarvis/capability-sdk`; `defineCapability()` + manifest
/ worker codegen + security lint. "Easy to build correctly, hard to build
insecurely" (ADR-0030).

**Resource constraint** — a per-grant allowlist that narrows a scope to
concrete resources: `repo-allow`, `path-prefix`, `domain-allow`,
`command-allow`, `container-image-allow`, `max-amount` (ADR-0027).

**Dual control** — the CRITICAL authorisation: an operator `approve` **plus** a
typed `confirmationPhrase`, from the same session at `authTrustLevel:
verified`, always simulate-first. Two principals is deferred to multi-user.

**Sentinel** — defensive security intelligence: a deterministic Kernel-internal
detector service raising `jarvis.security.alert.*` + a proposing-only
`sentinel` specialist. No offensive capability exists or can be registered
(`SENTINEL_MODEL.md`, ADR-0028).

**Guardian Response Playbook** — the fixed, pre-authorised, **restrict-only**
action set run (through the Executor) on entering `GUARDIAN` mode: tighten
grants, suspend autonomous external actions, lock CRITICAL, snapshot evidence,
isolate a named node, notify. Guardian mints no authority.

**FORGE** — the specialist that *drafts* a new capability (manifest + adapter
source) as a `CapabilityDraftProposal` from untrusted research; it cannot
build outside JARVIS LABS and cannot register.

**JARVIS LABS** — `apps/labs`; the isolated experimentation sandbox (ephemeral
Docker, synthetic credentials, mock APIs, throwaway PG + scratch FS,
default-deny network, resource limits, guaranteed teardown) where FORGE builds
and tests a capability draft before mandatory human review and operator-gated
registration (ADR-0029).

**Probation** — a newly-registered capability's initial state: effective
`riskClass = max(declared, HIGH)`, `approvalPolicy: 'always'`, every invocation
flagged by Sentinel, until a second explicit operator `capability.trust`
command.

## Perception & spatial

**Perception Plane** — the local-first processes that turn sensors into
`Observation`s: audio/wake/ASR, vision, hands, pose, presence, screen/app/
cursor telemetry. Never reasons, never routes to models for reasoning.

**Wake detection** — local, low-latency detection of the activation signal
that opens an interaction.

**Presence** — who and what is currently detected, and where. Owned by the
Presence Manager.

**Node** — any device that attaches to JARVIS through the Node Protocol:
workstation, local server, display, phone, later AR headset or robot. Declares
sensors and capabilities; heartbeats; receives scoped subscriptions.

**Scene Graph** — the shared spatial abstraction (`packages/scene`) unifying
physical space and digital surfaces. Entities may have spatial extent; nodes
and surfaces have positions.

## Interfaces

**Experience Plane** — every surface a principal perceives JARVIS through:
desktop shell, multi-monitor UI, voice, spatial UI, gesture, mobile, displays,
future AR/wearables. Consumes state; owns none (L6).

**Surface** — one addressable presentation target within the Experience Plane
(a monitor, a voice channel, an AR overlay).

## Cross-cutting

**Trust boundary** — a line across which data changes trust level. Crossing it
requires validation. Enumerated in `SECURITY_MODEL.md`.

**Validator** — the component (`packages/validation`) that checks untrusted
input (model output, web content, agent output, external API responses)
against a schema and policy before it may influence the system.

**Locality** — whether a workload runs on-device, on the local server, or in
cloud. Governed by the Locality Model.

**Failure domain** — a boundary within which a failure is contained. Enumerated
in `FAILURE_MODEL.md`.

**Extraction seam** — a documented boundary at which an in-process module can
later become a separate service without redesign, because it already
communicates only through contracts and events.
