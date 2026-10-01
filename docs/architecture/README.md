# JARVIS MK.42 — Architecture

This directory is the **constitution**. It defines what JARVIS is, what it is
not, where authority lives, and how the system must be built for the next ten
years. Implementation is subordinate to it (see `PRINCIPLES.md` §Precedence).

## Reading order

| # | Document | What it settles |
|---|---|---|
| 1 | [`PRINCIPLES.md`](PRINCIPLES.md) | The 40 laws + how each is structurally enforced |
| 2 | [`GLOSSARY.md`](GLOSSARY.md) | Exact meaning of every term used below |
| 3 | [`MK42_ARCHITECTURE.md`](MK42_ARCHITECTURE.md) | The entire system in one document; planes; the adversarial review |
| 4 | [`KERNEL_CONSTITUTION.md`](KERNEL_CONSTITUTION.md) | The frozen Kernel component set; what may never leak in |
| 5 | [`SYSTEM_BOUNDARIES.md`](SYSTEM_BOUNDARIES.md) | Every plane/module boundary; what talks to what, and how |
| 6 | [`DATA_OWNERSHIP.md`](DATA_OWNERSHIP.md) | The definitive owner of every category of state; consistency requirements |
| 7 | [`STATE_MODEL.md`](STATE_MODEL.md) | Event Log, Projected State, Ephemeral State; event sourcing scope |
| 8 | [`EVENT_ARCHITECTURE.md`](EVENT_ARCHITECTURE.md) | Envelope, subjects, outbox, ordering, idempotency, retention |
| 9 | [`WORLD_MODEL.md`](WORLD_MODEL.md) | Entities, facts, evidence, provenance, confidence, temporal validity, belief revision (superseded by `ATLAS_MODEL.md`) |
| 10 | [`ATLAS_MODEL.md`](ATLAS_MODEL.md) | ATLAS — the temporal world model: `atlas.*` schema, promotion pipeline, causal hypotheses, `AtlasQuery` (MK.46) |
| 11 | [`MNEMOSYNE_MODEL.md`](MNEMOSYNE_MODEL.md) | MNEMOSYNE — memory: durable classes, candidate pipeline, DREAMING consolidation, seven-factor recall (MK.46) |
| 12 | [`COGNITION_MODEL.md`](COGNITION_MODEL.md) | Model Gateway, reasoning, agents, proposals, provider replaceability |
| 13 | [`PERCEPTION_MODEL.md`](PERCEPTION_MODEL.md) | Sensors → observations; local-first; the perception/cognition wall |
| 14 | [`AGENCY_MODEL.md`](AGENCY_MODEL.md) | Capabilities, the Executor pipeline, the 14-state action lifecycle, credential broker, simulation, verification, rollback, self-extension |
| 15 | [`SECURITY_MODEL.md`](SECURITY_MODEL.md) | Trust boundaries, risk→authority tiers, policy evaluation order, structural injection defense, credential partitioning, audit |
| 16 | [`SENTINEL_MODEL.md`](SENTINEL_MODEL.md) | Defensive security intelligence: deterministic detectors, the proposing-only specialist, the Guardian Response Playbook |
| 17 | [`LOCALITY_MODEL.md`](LOCALITY_MODEL.md) | What runs on-device vs local server vs cloud, and why |
| 18 | [`FAILURE_MODEL.md`](FAILURE_MODEL.md) | Degradation ladder for every dependency failure |
| 19 | [`ROADMAP.md`](ROADMAP.md) | Current evidence-bearing status plus historical MK.42 → MK.100 lineage |
| 19a | [`VERSIONING.md`](VERSIONING.md) | Product release vs architectural MK/component/schema version semantics |
| 19b | [`MARK42_EXPERIENCE_TARGET.md`](MARK42_EXPERIENCE_TARGET.md) | Authoritative Forge Cosmos Experience target and truthful derived-projection boundary |
| 19c | [`DESKTOP_TRANSPORT.md`](DESKTOP_TRANSPORT.md) | Implemented snapshot-bootstrap and authenticated realtime Experience transport, recovery and stale-data behavior |
| 19d | [`FORGE_COSMOS_RENDERER.md`](FORGE_COSMOS_RENDERER.md) | GPU/DOM boundary, truthful visual-state mapping, quality tiers and explicit performance budgets |
| 20 | [`MK43_IMPLEMENTATION_NOTES.md`](MK43_IMPLEMENTATION_NOTES.md) | The Nervous System as built: ratified changes, environment-forced toolchain deviations, real-vs-placeholder |
| 21 | [`AUDIT_MK42_ASCENSION.md`](AUDIT_MK42_ASCENSION.md) | Hostile external architecture audit (ASCENSION Stage A): design vs as-built, the hollow-agency-plane finding, scores, required corrections |
| 22 | [`HARDENING_SPEC_MK42.md`](HARDENING_SPEC_MK42.md) | ASCENSION Stage B implementation direction: task groups H1–H13, chaos/perf/fitness/contract gates, the FOUNDATION_REVIEW template |
| 23 | [`AUDIT_MK42_ASCENSION_II.md`](AUDIT_MK42_ASCENSION_II.md) | Hostile external audit II: verified the Stage B brief, found ATLAS/MNEMOSYNE absent and the integration gate self-skipping |
| 24 | [`MK42_RELEASE_CANDIDATE_AUDIT.md`](MK42_RELEASE_CANDIDATE_AUDIT.md) | **RC1 certification.** Hostile release audit: verdict, per-area scores, verified vs unverified functionality, security/privacy/recovery findings, the 13 defects fixed during the pass, and the conditions MK.43 must not build past |
| 25 | [`MK42_RC1_1_EVENT_FABRIC_AUDIT.md`](MK42_RC1_1_EVENT_FABRIC_AUDIT.md) | **RC1.1 certification.** Event-fabric audit: JetStream subject ownership proved against a live server (109 events, one owner each), the unbounded dead-letter recursion that survived the previous fix, the unhandled-rejection regression in the health lifecycle, real NATS outage/recovery evidence, and the start-up/run-time degradation asymmetry still open |
| 26 | [`MK42_RC1_2_ALIGNMENT_AUDIT.md`](MK42_RC1_2_ALIGNMENT_AUDIT.md) | RC1.2 code/docs/package/security/observability alignment, exact local gate evidence, and the unresolved Docker-backed verification block |

## Decision records

[`adr/`](adr/) — one record per major decision, each with context, decision,
alternatives, benefits, disadvantages, risks, consequences, and **reversal
difficulty**.

## Diagrams

[`diagrams/`](diagrams/) — Mermaid sources, also embedded inline in the
relevant document:

| File | Shows |
|---|---|
| `global-architecture.mmd` | All seven planes and their traffic |
| `kernel-components.mmd` | The 16 Kernel components and their internal edges |
| `event-flow.mmd` | Command → event → outbox → NATS → projections/consumers |
| `state-ownership.mmd` | Which component owns which store |
| `cognition-flow.mmd` | ContextFrame → cognition/agents → proposal → validation → execution |
| `capability-execution.mmd` | The full Executor pipeline |
| `perception-flow.mmd` | Sensors → local processing → observation events → Context Compiler |
| `world-model-interactions.mmd` | Observations/proposals → ingestion → facts/evidence → queries |
| `node-architecture.mmd` | Workstation + local server nodes; future node types |
| `trust-boundaries.mmd` | Untrusted / semi-trusted / trusted zones and the crossings |

## The one-paragraph definition

> JARVIS is a persistent, event-driven artificial-intelligence operating layer
> that maintains a temporal model of the world, coordinates specialised
> intelligence, perceives through distributed sensors, executes actions through
> permissioned capabilities, remembers experience, manages persistent
> objectives, understands digital and physical context, and presents one
> consistent intelligence across all connected devices. The models are not
> JARVIS; they are replaceable cognitive resources it uses.
