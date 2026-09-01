# MK.42 Constitution — The 40 Laws

These are the invariant laws of JARVIS. Every document, ADR, module, contract,
and future implementation phase is subordinate to them. When implementation
convenience conflicts with a law, **the law wins**.

Cite laws by number, e.g. "gateway credential isolation (L26, L30)".

Each law below carries a short **enforcement note**: *how* the architecture
makes the law true rather than merely stating it. If a law has no structural
enforcement, that is a defect to be fixed, not a matter of discipline.

---

## Identity & Persistence

**L1. JARVIS is not an LLM.**
Enforcement: no module named or typed as a model. Models are entries in the
Model Registry, reached only through the Model Gateway. The Kernel has no
dependency on any model SDK.

**L2. JARVIS persists between conversations.**
Enforcement: conversations are `Session` projections over the Event Log. The
authoritative state (objectives, world model, memory, grants) has no
conversation scope and outlives every session.

**L3. AI providers are interchangeable.**
Enforcement: `ModelRequest`/`ModelResponse` contracts are provider-neutral.
Providers are adapters behind the gateway. Removing a provider is a config
change plus adapter deletion — no Kernel change, no contract change.

**L4. Every meaningful occurrence can be represented as an event.**
Enforcement: one `Event` envelope contract. Every state change, observation,
proposal, decision, execution, and failure emits one. No side channels.

## State & Authority

**L5. JARVIS has one authoritative logical system state.**
Enforcement: the Event Log (history) + Projected State (current values) in
PostgreSQL, owned solely by the Kernel State Manager. Defined in
`STATE_MODEL.md`.

**L6. Interfaces consume state but do not own authoritative state.**
Enforcement: Experience Plane apps hold only view/session-local state. They
mutate the system exclusively by submitting `Command`s / `Proposal`s that the
Kernel validates. No interface has write access to any authoritative store.

**L7. Perception and cognition are separate systems.**
Enforcement: perception processes emit only `Observation` events and may not
import the Model Gateway client or the Cognition packages. Wiring enforced by
package boundaries and lint rules.

**L8. Memory and the World Model are separate systems.**
Enforcement: distinct packages, distinct PostgreSQL schemas, distinct service
APIs. Memory answers "what is relevant to now"; the World Model answers "what
is currently true, and why". Neither writes the other.

**L9. Agents are disposable workers; JARVIS is persistent.**
Enforcement: the Agent Runtime spawns agents with a lease, a scoped context,
and no persistent handles. Agent death is normal and never loses system state.

**L10. Agents may not own authoritative system state.**
Enforcement: agents have no credentials for authoritative stores. Agent output
enters the system only as validated `Proposal`s or `Observation`s.

## Epistemics

**L11. Every important fact has provenance.**
Enforcement: `Fact.provenance` is non-optional in the contract. Facts without
provenance cannot be persisted by the World Model service.

**L12. Facts have confidence.**
Enforcement: `Fact.confidence` (0..1) is non-optional.

**L13. Facts may have temporal validity.**
Enforcement: `Fact.validFrom` / `Fact.validTo`. Queries are time-scoped;
"currently true" is `validFrom <= now < validTo`.

**L14. JARVIS distinguishes observed, asserted, retrieved, inferred, predicted and derived information.**
Enforcement: `EpistemicStatus` enum on every `Fact` and `Observation`. No
"unknown" default — the producer must classify.

**L15. JARVIS must understand why it believes something.**
Enforcement: `Evidence` links every `Fact` to the `Observation`s, sources, or
parent facts that support it. Belief is traversable.

**L16. JARVIS must represent uncertainty.**
Enforcement: confidence is mandatory; contradictory facts coexist with a
recorded conflict rather than silent overwrite.

**L17. JARVIS must know when it does not know.**
Enforcement: absence of a fact is a first-class query result
(`{ known: false }`), distinct from a low-confidence fact. Cognition receives
explicit "no information" markers in `ContextFrame`s.

## Action, Policy & Verification

**L18. Every consequential action is permissioned.**
Enforcement: all effects run through the Capability Executor, which calls the
Policy Engine then the Permission Engine before invoking any adapter. No
adapter is reachable another way.

**L19. Higher-risk actions require stronger authority.**
Enforcement: `Capability.riskClass` maps to a fixed authority-tier table in
`SECURITY_MODEL.md`. The Permission Engine refuses under-authorised calls.

**L20. Policy enforcement must be deterministic wherever possible.**
Enforcement: the Policy Engine is a pure rule evaluator over typed inputs. Same
inputs, same decision. No network calls, no model calls inside evaluation.

**L21. An LLM may recommend a policy decision but may never override policy.**
Enforcement: a model can emit a `PolicyRecommendation` that the Policy Engine
*may read as one input*. The decision function never calls a model and cannot
return a model's verdict verbatim without rule support.

**L22. Actions must be verified rather than assumed successful.**
Enforcement: every `Capability.action` declares a `verify` step. The Executor
runs it and emits `capability.verified` or `capability.verification_failed`.
"Assumed success" is not a code path.

**L23. Reversible actions should define rollback behaviour.**
Enforcement: `Capability.reversible` + `Capability.rollback`. The Executor
invokes rollback automatically on post-execution verification failure.

**L24. Dangerous actions should be simulated before execution where practical.**
Enforcement: `Capability.simulate`. For `riskClass >= HIGH` the Executor runs
simulate first and requires the simulated effect to be presented for approval.

## Locality

**L25. Local processing is preferred for simple realtime perception, privacy-sensitive operations and low-latency operations.**
Enforcement: perception processes run on the workstation; the Locality Model
classifies every workload and the Model Gateway honours a `locality` constraint
on `ModelRequest`.

**L26. Cloud intelligence is a computational resource, not part of JARVIS's identity.**
Enforcement: see L1, L3. The Kernel runs and makes decisions with zero cloud
reachability (degraded, not dead — see `FAILURE_MODEL.md`).

**L27. Continuous camera feeds remain local by default.**
Enforcement: the vision process never transmits raw frames off-host. It emits
derived `Observation`s. Sending a frame to cloud requires an explicit,
per-instance HIGH-risk capability invocation.

## Kernel Protection & Security

**L28. New capabilities extend JARVIS without uncontrolled Kernel mutation.**
Enforcement: a capability is a manifest + out-of-process adapter. Registering
one touches the Capability Registry only. The Kernel binary does not change.

**L29. The Kernel is protected.**
Enforcement: `KERNEL_CONSTITUTION.md` defines the frozen component set. Adding a
Kernel component requires an ADR. Kernel modules cannot be modified by agents,
capabilities, or interfaces at runtime.

**L30. Security is architectural, not prompt-based.**
Enforcement: no security control is a string in a prompt. Trust boundaries are
process boundaries, credential scopes, and the Validator. A jailbroken model
gains nothing because it holds nothing.

**L31. Important behaviour must be auditable.**
Enforcement: the Audit Manager derives an append-only audit trail from events.
Every policy decision, permission grant, capability execution, and model call
is reconstructable with provenance.

## Spatial, Multimodal & Future-Proofing

**L32. Physical and digital environments eventually share a coherent spatial abstraction.**
Enforcement: `packages/spatial` + `packages/scene` define a Scene Graph now
(entities have optional spatial extent), populated incrementally.

**L33. Voice, gesture, gaze, cursor, UI state and environmental context may combine to resolve meaning.**
Enforcement: the Context Compiler fuses multiple `Observation` streams into one
`ContextFrame`. Intent resolution consumes the frame, not a single modality.

**L34. The architecture must support future multi-user operation.**
Enforcement: every authoritative row is `principalId`-scoped from day one.
MK.42 runs one principal; multi-user is data + policy, not re-architecture.

**L35. The architecture must support future multi-device operation.**
Enforcement: the Node Protocol + Presence Manager. Devices are nodes.

**L36. The architecture must support future local models.**
Enforcement: local inference is just another Model Registry entry with
`locality: local`. The gateway routes to it identically.

**L37. The architecture must support future AR.**
Enforcement: an AR headset is a node type providing `pose`, `gaze`, `hands`
observations and a spatial-UI surface capability. Scene Graph already exists.

**L38. The architecture must support future robotics/device control.**
Enforcement: a robot is a node exposing high-risk `capabilities`. The Executor,
Policy Engine, simulation, and verification pipeline already gate it.

## Resilience & Evolution

**L39. The architecture must degrade gracefully when external AI or network services fail.**
Enforcement: `FAILURE_MODEL.md` defines a degradation ladder per dependency.
The Kernel holds a local durable queue; loss of NATS/Redis/cloud degrades
function, never corrupts state.

**L40. MK.43 through MK.100 must be able to evolve from MK.42 without destroying its foundations.**
Enforcement: contracts are versioned; extraction seams are documented; the
Kernel component set is frozen-by-ADR; every distribution boundary is already a
message boundary. Evolution adds nodes, capabilities, models, and agents —
never rewrites the spine.

---

## Precedence

1. These 40 laws.
2. `KERNEL_CONSTITUTION.md`.
3. The model documents (`*_MODEL.md`, `SYSTEM_BOUNDARIES.md`, `DATA_OWNERSHIP.md`).
4. ADRs.
5. Implementation.

A lower level may refine but never contradict a higher one. A contradiction is
a bug in the lower level.
