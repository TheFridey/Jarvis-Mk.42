# THE MIND — Cognitive Architecture Design Spec

Phase: **MK.45 (Cognition) + MK.48 (Objectives & autonomy loop) + Daedalus (new) + Cognitive Timeline (new)**.
Status: **Draft for review.**
Subordinate to `docs/architecture/PRINCIPLES.md` (the 40 laws), `KERNEL_CONSTITUTION.md`, the
model documents, and the ADRs. A contradiction with any of those is a bug in this spec.

Repo maturity at authoring time: **MK.43 spine built** (event fabric, State Manager, modes,
Identity, Sessions, Presence, Health, Scheduler, Notifications, deterministic Context Compiler,
Diagnostics) + **MK.46 knowledge = foundation only** (contracts + `atlas`/`mnemosyne` schemas +
ADRs 0020–0023; no live ATLAS/MNEMOSYNE services yet). **MK.44 (Authority) is unbuilt** — no
Policy Engine, Permission Engine, Capability Registry, or Capability Executor.

Agreed structure (this session): **one coherent "THE MIND" architecture spec covering everything,
then decompose implementation into ordered sub-plans**. Build depth per sub-plan matches MK.46:
real services against interface-stubbed MK.44 dependencies (Policy / Permission / Executor).

---

## 1. Purpose & the invariant

Design the cognitive architecture: how JARVIS reasons, plans, pursues objectives, and simulates —
without any of it becoming JARVIS.

> **NO AI PROVIDER IS JARVIS.** Identity, state, memory, world model, permissions, and objectives
> survive model replacement. Models and agents produce only `ModelResponse` / `AgentResult` /
> `Proposal` values on validated channels. Remove every model and agent and the Kernel still
> runs, decides, and holds all state — it just reasons less well. This is L1 / L3 / L26 made
> structural.

### 1.1 In scope

Model Gateway contract extension + routing foundation; Model Registry (Kernel #11); Agent Runtime
(Kernel #12) + `AgentContract` + specialist/worker tiers; a new **Cognition Orchestrator** (the
"executive", a Kernel-internal protected service — ADR, not a 17th frozen component); the
INTENT→…→MEMORY-CANDIDATE planning pipeline; the `Plan` model; the **Cognitive Timeline** (an
Audit Manager projection); contradictory-agent resolution; the Objective Engine (Kernel #7) with
rich objectives, gap analysis, and a restrict-only **objective authority ceiling**; the
**Daedalus Simulation Engine** (new Kernel-internal protected service — ADR) with counterfactual
ATLAS branching and the four evidence classes; a unified `CognitiveBudget`; cognition failure
handling.

### 1.2 Out of scope this phase

Automated model-quality learning (needs an eval harness — routing `qualityPrior` stays
operator-set data). Deep per-specialist prompt engineering ("do not overbuild every specialist's
intelligence yet — build the infrastructure correctly"). Real provider API keys in the shipped
tests (a keyless stub adapter covers model paths). Domain models that need real ScaleSmiths /
ATLAS data run against fixtures until that data lands.

### 1.3 Constitutional grounding

- **L1 / L3 / L26** — JARVIS is not an LLM; providers are interchangeable; cloud is a resource.
- **L9 / L10** — agents are disposable; agents own no authoritative state.
- **L18–L24** — every effect through the Executor pipeline; deterministic Policy; an LLM may
  recommend a policy decision but never render it; verify mandatory; simulate-first for HIGH+.
- **L30 / L31** — security is architectural; important behaviour is auditable.
- **L20** — deterministic policy; same inputs ⇒ same decision.
- ADR-0010 — the Model Gateway is the sole inference egress, a separate process.
- ADR-0019 — operating modes are restrict-only; `AUTONOMOUS` never raises a risk ceiling.
- ADR-0020 precedent — Executor-class protected internal services are named + protected without
  expanding the frozen 16.
- ROADMAP "The invariant" — `ModelRequest` shape versions additively; the 16 components and their
  ownership do not change without an ADR.

---

## 2. Structural decision (Approach A)

Layered cognition: a thin Kernel-internal **Cognition Orchestrator** over the out-of-process
**Model Gateway** and the **Agent Runtime**.

| Piece | Home | Role |
|---|---|---|
| **Model Gateway** | `apps/gateway` (separate process, ADR-0010) | Provider adapters; owns keys, the routing engine, circuit breakers, cache, streaming. Extended `ModelRequest` dimensions + `TaskClass`. |
| **Model Registry** | Kernel #11 (exists, placeholder) | `catalogue.models` + `catalogue.routing_policy` (data); folds `model.called` / `model.call_failed` into recent latency / failure-rate. **No provider name hard-coded in code.** No credentials. |
| **Agent Runtime** | Kernel #12 (exists, placeholder) | Spawns/leases/reaps agents as OS workers; sole emitter of events on validated agent output; owns `AgentManifest`/`Assignment`/`Result` and `projections.agent_runs`. |
| **Cognition Orchestrator** | **NEW Kernel-internal protected service (ADR-0024)** | Owns the INTENT→CONTEXT→PLAN→POLICY→RISK→PERMISSION→EXECUTION→VERIFICATION→WM-UPDATE→MEMORY-CANDIDATE pipeline as a per-`correlationId` state machine; the "is cognition needed" gate; specialist selection; synthesis; disagreement resolution; step-event emission. Holds only `projections.cognition_runs` (its own in-flight state). |
| **Cognitive Timeline** | Audit Manager #16 projection (`audit.cognitive_timeline`) | Folds `jarvis.cognition.*` + correlated `capability.*` / `policy.decided` / `grant.*` / `model.called` into a per-interaction "why did you do that?" record. No new store, no new owner. |
| **Objective Engine** | Kernel #7 (exists, placeholder) | Rich `Objective`; gap analysis (desired vs actual from ATLAS / metrics / capability verify); decomposition; per-objective **authority ceiling** that can only *restrict*. |
| **Simulation Engine (Daedalus)** | **NEW Kernel-internal protected service (ADR-0028)** | `SimulationRequest` / `Result` with 4 evidence classes; counterfactual = read-only ATLAS snapshot + in-memory overlay, never written back; deterministic harness + statistical/heuristic estimators + a model-projection path always labelled as such; pluggable `SimulationDomain` modules. |
| **Validator** | `packages/validation` (exists) | Every model / agent output validated before it influences anything. |

Every piece maps to an existing frozen-16 component or an Executor-class protected service.
**No frozen-set change.**

Rejected: **B** (emergent executive — "decide whether cognition is needed / choose specialists /
synthesize / resolve disagreement" has no single owner). **C** (fold orchestration into the Agent
Runtime — turns a narrowly-chartered frozen component into a God service; ROADMAP anti-goal).

---

## 3. Model Gateway, `ModelRequest` dimensions, Model Registry

The Gateway charter is unchanged (ADR-0010, `COGNITION_MODEL` §2). This section extends the
contracts and the Registry.

### 3.1 `ModelRequest` — additive extension (`packages/contracts/src/model.ts`)

Existing fields stay; new fields added, mostly optional (ROADMAP "versions additively").

| Brief dimension | Contract field | Notes |
|---|---|---|
| taskType | `taskClass?: TaskClass` | New canonical enum (§3.2). Existing `task: ModelTask` kept, marked deprecated; gateway prefers `taskClass`. |
| reasoningLevel | `reasoning?: 'none' \| 'light' \| 'standard' \| 'deep'` | Distinct axis from `determinism`. |
| latencyTarget | `latencyClass?: 'realtime' \| 'interactive' \| 'batch'` + existing `budget.maxLatencyMs` | Semantic tier + hard cap. |
| modalities | `modalities?: Modality[]` | `text \| image \| audio_in \| audio_out \| video`. |
| contextLength | existing `budget.contextUnits` + `minContextUnits?` | Filter models whose limit is too small. |
| privacy | `privacyClass?: PrivacyClass` | The event-envelope 4-band enum. **Hard routing filter** (§4). |
| cloudAllowed / localPreferred | existing `locality: 'local' \| 'prefer-local' \| 'any' \| 'cloud-ok'` | Already covers both. |
| toolRequirement | existing `capabilities: ['tools']` + `toolChoice?: 'none' \| 'auto' \| 'required'` | |
| structuredOutputRequired | `structuredOutput?: { schema: JSONSchema }` | Stronger than `capabilities:['json']`; gateway rejects a model that can't guarantee it. |
| budget | existing `budget{}` + `maxToolCalls?`, `maxAttempts?` | |
| reliability | `minReliability?: number` (0..1) | Filters by the Registry's rolling success rate. |
| deadline | `deadline?: Timestamp` | Absolute wall-clock, distinct from per-call `maxLatencyMs`. |

`ModelResponse` gains `attempts: AttemptRecord[]` (`{ modelId, finishReason, latencyMs, errorClass? }`)
and `structuredOutputValid?: boolean`.

### 3.2 `TaskClass` (canonical, open enum)

`realtime_conversation`, `intent_classification`, `planning`, `deep_reasoning`, `coding`, `vision`,
`research`, `document_analysis`, `summarisation`, `embedding`, `reranking`, `speech_recognition`,
`speech_generation`. `(string & {})` — new classes are data.

### 3.3 Model Registry (Kernel #11) — two `catalogue.*` tables

- **`catalogue.models`** — `ModelRegistration` extended with: `modalities`,
  `structuredOutputSupport: 'none'|'json'|'json_schema'|'grammar'`,
  `toolSupport: 'none'|'sequential'|'parallel'`, `reasoningLevels: ReasoningLevel[]`,
  `latencyProfileMs: { p50, p95 }`, `maxPrivacyClass` (highest sensitivity this model's route may
  carry — a local model can be `RESTRICTED`; cloud defaults capped at `INTERNAL`,
  operator-configurable per model), `costProfile { perContextUnit, perOutputUnit, perToolCall? }`.
- **`catalogue.routing_policy`** — versioned rows (data): a weight vector + hard filters per
  `TaskClass`. **No provider name hard-coded anywhere in code** — "coding prefers a high-`reasoning`
  `coding`-capable model" is a policy row, editable without deploy.

The Registry **derives** `availability` (`available|degraded|unavailable`) and `recentFailureRate` /
observed `latencyProfileMs` by folding `jarvis.cognition.model.called` and a new
`jarvis.cognition.model.call_failed` (`errorClass: outage|rate_limit|timeout|refusal|malformed|
context_overflow|budget_exceeded`) into `catalogue.model_health` (EWMA). It holds **no credentials**
(ADR-0010). It serves a `RoutingSnapshot` to the gateway (pull on interval + push on change).

---

## 4. Routing foundation

Routing lives **in the gateway**, as a pure function `route(ModelRequest, RoutingSnapshot) →
RoutingPlan` — Policy-Engine style: deterministic, no I/O in the decision, replayable from its
inputs.

### 4.1 Stage 1 — hard filters (fail any ⇒ excluded, reason recorded)

- `taskClass` ∈ model `tasks`; every `modalities` supported; every `capabilities` supported.
- `structuredOutput` requested ⇒ `structuredOutputSupport` ≥ requested strength.
- `toolChoice: 'required'` ⇒ `toolSupport ≠ 'none'`.
- `contextLimitUnits ≥ max(budget.contextUnits, minContextUnits ?? 0)`.
- `locality`: `local` ⇒ local models only; `prefer-local` ⇒ keep both, tier local in Stage 2.
- **`privacyClass` gate**: `request.privacyClass ≤ model.maxPrivacyClass`. `RESTRICTED` can only
  route to a model cleared for it (MK.42: local). **A hard filter, never a score — L25 / L27
  must not be tradeable against cost.**
- `availability ≠ 'unavailable'` and the circuit breaker is not open.
- `minReliability` ⇒ rolling success rate ≥ it.

Empty filtered set ⇒ `RoutingPlan { primary: null, reason: 'no_model_satisfies_constraints' }`;
gateway returns `finishReason: 'error'`, `errorClass: 'no_route'`; cognition handles it (§11), no
crash.

### 4.2 Stage 2 — weighted score (weights from the `routing_policy` row for the `taskClass`)

```
score(m) =  w_quality    · qualityPrior(m, taskClass)          // operator-set per-class prior
          + w_reliability · m.rollingSuccessRate
          + w_latency     · latencyFit(m.latencyProfileMs, latencyClass, deadline)
          − w_cost        · estimatedCost(m, request.budget)     // normalised 0..1
          + w_locality    · localityBonus(m, request.locality)
          + w_recency     · freshnessOfMetrics(m)
```

`determinism` / `reasoning` are **soft tie-breakers** after score. `RoutingPlan = { primary,
fallbacks: ModelId[], policyVersion, filterTrace, scoreTrace }`.

### 4.3 Fallback chain

On a call failure the gateway advances to `fallbacks[0]`, `[1]`, … up to `budget.maxAttempts ?? 2`.
Each attempt appends to `ModelResponse.attempts[]`. Exhausted ⇒ `finishReason: 'error'` with the
last `errorClass`.

### 4.4 Explicit overrides (debugging)

`ModelRequest.debug?: { forceModelId?, forcePolicyVersion?, explain? }`. `forceModelId` **skips
Stage 2 only** — the hard filters (especially `privacyClass`) still apply; a forced model failing
a filter ⇒ `errorClass: 'override_rejected'`. `explain: true` returns `filterTrace` + `scoreTrace`
in `ModelResponse.meta` and emits `jarvis.cognition.route.explained` (DIAGNOSTIC). Overrides are
accepted only from a `kernel-local` / `owned-secure` surface and are audited.

### 4.5 Learning loop (foundation only)

The Registry projection EWMA-updates `rollingSuccessRate` and observed `latencyProfileMs` from
`model.called` / `model.call_failed`. `qualityPrior` stays operator-set data this phase.

---

## 5. Agent Runtime, `AgentContract`, specialists & workers

Agent Runtime (Kernel #12) keeps its `COGNITION_MODEL` §6 charter: leases, scoped context, no
credentials, sole emitter of events on validated agent output, agents can't publish NATS / call
the Executor / spawn sub-agents except by asking it.

### 5.1 `AgentManifest` (`agents/<name>/manifest.json`, source-controlled, versioned)

```
id, version, displayName, tier: 'specialist' | 'worker'
role
leasePolicy: { maxWallTimeMs, maxContextUnits, maxCostUnits, maxToolCalls, maxWorkerRequests }
proposalScope: { kinds: ProposalKind[], capabilities: string[] }   // capability IDs it may PROPOSE, never invoke
allowedTools: ToolName[]      // read-only mediated APIs (atlas_query, memory_recall, gateway_infer, ...)
modelHints: { taskClass, reasoning, locality }
inputSchemaRef, resultSchemaRef
mayRequestWorkers: WorkerId[]   // specialists only; workers = []
```

### 5.2 `AgentAssignment` (Runtime → agent — the invocation contract)

```
assignmentId, correlationId, parentAssignmentId?
objective: { statement, params }              // params validated against inputSchemaRef
scope: { entities: Ulid[], objectives: Ulid[], timeWindow? }
contextPackage: ContextFrame                  // budgeted, from the Context Compiler — NOT raw store access
allowedTools: ToolGrant[]                     // each with its own budget slice
proposalScope: { kinds, capabilities }        // narrowed from the manifest
budget: { costUnits, contextUnits, wallTimeMs, toolCalls }
deadline: Timestamp
resultSchema: JSONSchema
```
"Permissions" the brief lists = `proposalScope` + `allowedTools`. Agents hold no grants and no
store credentials.

### 5.3 `AgentResult` (agent → Runtime — structured; `result` is machine-critical, never prose)

```
assignmentId
status: 'completed' | 'partial' | 'failed' | 'refused' | 'timed_out' | 'budget_exhausted'
result: <validates against resultSchema>
evidence: EvidenceRef[]                        // event / fact / episode / tool-result ids, urls w/ trust tag
confidence: number
actionsAttempted: [{ kind: 'tool'|'proposed_capability', ref, input, outcome }]
toolResults: [{ tool, ok, summary, ref }]
cost: { costUnits, contextUnits, wallTimeMs, toolCalls, modelCalls }
warnings: string[]
unresolvedUncertainties: [{ about, whyUnresolved, whatWouldResolve }]
recommendedNextSteps: [{ step, rationale, estimatedCost? }]
narrative?: string                            // human summary allowed; never the decision payload
```
The Runtime validates `AgentResult` against manifest + assignment schemas before emitting
`jarvis.cognition.agent.completed` / `.failed`. Invalid ⇒ malformed-output path (§11).

### 5.4 Tier model

| Tier | Is | Spawned by | Lease / scope |
|---|---|---|---|
| **Executive** | the Cognition Orchestrator (§6) — in-Kernel, deterministic-or-Kernel. *Not an agent.* May call the gateway for intent classification / synthesis; those returns are validated `Proposal`s, not decisions. | — | — |
| **Specialist** | one durable manifest per reasoning domain. Roster (`agents/*`): `oracle` strategy/planning, `forge` engineering, `scout` research, `argus` visual reasoning, `hermes` comms, `sentinel` security, `atlas` world-model reasoning, `mnemosyne` memory analysis, `prometheus` creative/design, `daedalus` simulation-scenario construction, `hephaestus` device/control planning. | Orchestrator, per interaction / objective | manifest `leasePolicy`; broad-ish proposal scope within its domain |
| **Worker** | a narrow `worker`-tier manifest (`agents/workers/*`): repo-searcher, test-analyser, log-analyser, sql-analyser, doc-analyser, browser-researcher, dependency-researcher, benchmark-worker, perf-profiler. Minimal proposal scope (`answer` / `fact_extraction`, no capabilities). | Runtime — on the Orchestrator's call, or on a specialist's *proposal* which the Runtime re-decides as a fresh lease | very short wall-time, tight budget, `mayRequestWorkers: []` |

### 5.5 Roster reconciliation

The brief reassigns three roles vs the current `COGNITION_MODEL` §6 roster: `atlas` → world-model
reasoning (not data-analysis), `prometheus` → creative/design (not planning), `daedalus` →
simulation-scenario construction (not architecture). `COGNITION_MODEL` §6 and the manifests are
updated to match; no code impact.

### 5.6 Isolation & lifecycle

Runtime spawns the agent as an OS worker with zero env credentials and a mediated channel to
(a) the gateway (`onBehalfOf` stamped), (b) `allowedTools` read APIs, (c) a scratch workspace via
a `filesystem` workspace scope. Heartbeat + wall-time + budget meter; breach ⇒ kill ⇒
`agent.failed` with partial validated output if usable (`FAILURE_MODEL` §"Agent crashes"). Runtime
owns `projections.agent_runs`; Redis holds the live lease.

---

## 6. Cognition Orchestrator, planning pipeline, Cognitive Timeline

**Cognition Orchestrator** — a new Kernel-internal protected service (ADR-0024, Executor-class;
*not* a 17th frozen component). Owns the pipeline state machine, the "is cognition needed" gate,
specialist selection, synthesis, disagreement resolution, and step-event emission. Holds only
`projections.cognition_runs` (in-flight pipeline state — folded from its `jarvis.cognition.*`
events on Kernel restart, exactly how the Executor recovers orphaned executions).

### 6.1 The pipeline

Each arrow is the Orchestrator (deterministic sequencing) consuming *validated* inputs; a model
output never crosses a stage boundary by itself.

| Stage | Orchestrator does | Step event |
|---|---|---|
| **INTENT** | Interaction arrives from one of the four `correlationId` minters (Session / Perception-ingress / Scheduler / Objective Engine). Deterministic gate: single unambiguous AMBIENT/LOW capability match → skip to EXECUTION; direct World Model / Memory query → templated answer, no model; ambiguous / open-ended → engage a specialist (only this touches a model). | `intent.classified` |
| **CONTEXT** | Request a budgeted `ContextFrame` from the Context Compiler (#5), scoped to the task class. | `context.assembled` |
| **PLAN** | Dispatch specialist(s) via the Agent Runtime with an `AgentAssignment`. `PlanProposal` (§8) for tasks, `AnswerProposal` for questions. Multiple specialists on one question → §7. Synthesize one candidate `Plan` / answer. Replanning re-enters here. | `plan.drafted` / `plan.modified` |
| **POLICY** | Each step carrying a `proposedInvocation` gets a **preview** verdict from the Policy Engine (#8) — the plan surfaces its approval gates up front. Advisory only. | `policy.evaluated` |
| **RISK** | Compute aggregate `RiskAssessment` (highest step `riskClass`, any `derivedFromUntrusted`, any irreversible-without-rollback, any CRITICAL). Plan exceeds the objective's authority ceiling (§9) or interaction budget → trim / re-plan / surface. | `risk.assessed` |
| **PERMISSION** | **Preview** from the Permission Engine (#9): does a standing grant scope exist, or will a step need live approval. Surface the full approval set. | `permission.evaluated` |
| **EXECUTION** | Hand each executable step, one at a time, to the **Capability Executor** as a validated `CapabilityInvocationProposal`. The Executor runs its own full **binding** pipeline (`AGENCY_MODEL` §3) — the Orchestrator's POLICY/RISK/PERMISSION were preview only. Approval gates pause here, fail-closed. | `step.dispatched` |
| **VERIFICATION** | Consume `capability.verified` / `.verification_failed` per step. Failure → declared rollback/compensation → replan or surface. | `action.verified` |
| **WORLD MODEL UPDATE** | Verified effects already write facts via the Executor. Route specialist `fact_extraction` proposals + interaction conclusions to **Knowledge Ingestion** (MK.46) as validated proposals. | `world_update.proposed` |
| **MEMORY CANDIDATE** | Emit a `MEMORY_CANDIDATE`-retention event summarising the interaction (objective, plan, outcome, cost, disagreements) for MNEMOSYNE's candidate scorer. | `memory_candidate.emitted` |

**Structural proof "sounds useful → production change" cannot happen:** the model emits a
`PlanProposal`; the Orchestrator sequences it through preview POLICY/RISK/PERMISSION; the Executor
re-checks everything binding; CRITICAL always simulates first and needs dual control; approval
gates fail closed. No stage is skippable and none is decided by a model.

### 6.2 "Decide whether cognition is needed"

A deterministic gate, not a model call: (a) single unambiguous capability match at AMBIENT/LOW
risk → skip to EXECUTION; (b) answer is a direct World Model / Memory query → templated answer,
no model; (c) ambiguous intent or open-ended task → engage a specialist. Only (c) touches a model.

### 6.3 Cognitive Timeline (Audit Manager #16 projection `audit.cognitive_timeline`)

Folds the `jarvis.cognition.*` step events + correlated `capability.*` / `policy.decided` /
`grant.*` / `model.called` into a per-`correlationId` ordered record:

```
CognitiveTimelineEntry { correlationId, seq, at,
  step: intent_classified | context_assembled | agent_assigned | tool_invoked
      | evidence_obtained | policy_evaluated | permission_evaluated | plan_drafted
      | plan_modified | recommendation_produced | action_verified
      | disagreement_recorded | memory_candidate_emitted,
  actor,            // component | agent | model(meta only) | system
  inputsRef: string[], outputRef: string,
  summary: string,  // STRUCTURED OPERATIONAL FACT — "assigned forge", "rule R-12 fired DENY",
                    // "verified: branch on remote" — never model chain-of-thought
  cost?: { costUnits, latencyMs } }
```

The projector maps raw events to timeline entry types (not 1:1): `agent.assigned` →
`agent_assigned`; an agent's mediated-tool call → `tool_invoked`; a `capability.verified` or an
agent's `evidence` ref → `evidence_obtained`; a synthesized answer / plan → `recommendation_produced`;
the pipeline's `risk.assessed` / `step.dispatched` / `world_update.proposed` fold into the nearest
adjacent entry rather than each getting their own type. The mapping table is fixed in ADR-0024.

Audit Manager serves `timeline(correlationId)` and `why(effectEventId)` (walks `causationId` back
to the intent). **No hidden chain-of-thought is persisted** — if a model returns a reasoning trace
the gateway discards it by default (content logging is a HIGH-risk capability, ADR-0010).

---

## 7. Contradictory-agent resolution

Owned by the Orchestrator. Triggered when ≥ 2 `AgentResult`s answer the same sub-question with
materially different typed `result` payloads (structural comparison against the assignment's
`resultSchema` — not string diff).

### 7.1 `DisagreementRecord`

Attached to the Cognitive Timeline (`disagreement_recorded`) and to the candidate `Plan` / answer
as `contested: true`.

```
DisagreementRecord {
  correlationId, subQuestion, recordedAt
  positions: [{ agentId, assignmentId, claim, argument, evidence: EvidenceRef[] (per-ref trust tag),
               confidence, modelId (meta only) }]
  reconciliation: {
    method: 'source_authority' | 'recency' | 'evidence_strength' | 'principal_correction'
          | 'model_consensus' | 'unresolved',
    outcome: 'dominates' | 'needs_more_evidence' | 'needs_another_model' | 'needs_principal'
           | 'preserved_as_open',
    chosenPositionAgentId?, rationale }
}
```

### 7.2 Resolution procedure — deterministic, no blind averaging

Run in order, stop at the first clear winner:

1. **Hard disqualifier.** Drop any position whose evidence chain is `derivedFromUntrusted` and
   whose claim would drive an action above `riskClass: LOW`, or which contradicts a high-confidence
   World Model fact with `epistemicStatus: observed|asserted`. One position left → `dominates`.
2. **Evidence strength.** Score each: count + independence of `evidence` refs, trust tags, whether
   they trace to `observed` vs `retrieved`/`inferred` facts. One exceeds the next by a configured
   margin → `dominates` (`method: evidence_strength`).
3. **Source authority + recency.** Reuse the ATLAS belief-revision ranking (`ATLAS_MODEL`
   §Belief revision): `asserted` > `observed` > `retrieved` > `derived` > `inferred` > `predicted`;
   ties broken by evidence recency. Clear winner → `dominates`.
4. **Confidence spread.** Only *after* 1–3, and only if surviving positions agree in direction and
   differ only in a numeric estimate: a confidence-weighted combination, **recorded as
   `method: model_consensus` with the spread preserved** — never a silent mean, never for a
   categorical disagreement.
5. **No winner** → the Orchestrator picks an `outcome`:
   - `needs_more_evidence` → spawn a `scout` / worker to gather the missing evidence, re-run
     (bounded to `maxAttempts`).
   - `needs_another_model` → re-dispatch to a different specialist / stronger `reasoning` model,
     re-run.
   - `needs_principal` → surface both positions + evidence via the Notification Manager; the
     interaction pauses (fail-closed for any dependent effect).
   - `preserved_as_open` → non-blocking disagreement: record it, mark the conclusion `contested`,
     continue; MNEMOSYNE stores it as an open uncertainty.

### 7.3 Bounds

Reconciliation rounds are capped by the interaction budget (`maxAgents`, `maxCost`, `deadline` —
§10). Exhausting the cap forces `needs_principal` or `preserved_as_open` — it never loops. **No
effect executes off a `contested` conclusion above `riskClass: LOW`** without resolution to
`dominates` or explicit principal approval — a deterministically enforced policy input, not an
Orchestrator judgement call.

---

## 8. Plan model

New contract `packages/contracts/src/plan.ts`. `PlanProposal` (in `proposal.ts`) stays the
cognition-emitted *candidate*; the Orchestrator promotes an accepted candidate into a live
**`Plan`** it drives.

```
Plan {
  id, correlationId, objectiveId?, taskId
  goal
  status: 'draft' | 'awaiting_approval' | 'executing' | 'paused' | 'replanning'
        | 'completed' | 'failed' | 'cancelled' | 'compensating'
  steps: PlanStep[]
  riskAssessment: RiskAssessment
  budget: { costUnits, wallTimeMs, toolCalls, agents }
  createdBy: agentId | 'orchestrator'
  version: number                    // bumps on every replan; old versions retained in the timeline
  createdAt, updatedAt
}

PlanStep {
  id, ordinal
  intent
  kind: 'capability' | 'sub_question' | 'wait' | 'checkpoint'
  proposedInvocation?: ProposedInvocation
  dependsOn: StepId[]                 // DAG edges, not just linear ordinal
  preconditions: Predicate[]          // deterministic checks run immediately before dispatch
  expectedEffect: string
  capabilityRequirements: { capabilityId, minRiskTierUnderstood: RiskClass, requiredScopes: string[] }
  reversible: boolean
  rollback?: ProposedInvocation       // how to undo THIS step
  verify: { via: 'capability_verify' | 'world_model_query' | 'agent_check', spec }
  approvalGate?: { reason, tier: 'approval' | 'hard_confirmation' }
  status: 'pending' | 'blocked' | 'dispatched' | 'awaiting_approval' | 'verified' | 'failed'
        | 'skipped' | 'compensated'
  attempts: number
  outcomeRef?: string                 // the capability.verified / .failed event id
}
```

- **DAG execution.** Dispatch a step when all `dependsOn` are `verified` and all `preconditions`
  hold. Independent branches run concurrently up to `budget.agents` / the resource-key leases the
  Executor enforces. A `checkpoint` is a no-op gate the principal or a policy rule can attach
  conditions to.
- **Dynamic replanning.** Triggers: a `verify` fails; a precondition that held at PLAN no longer
  holds; new evidence contradicts an `expectedEffect`; the principal edits the plan.
  `status: replanning` → re-enter PLAN with the failure context → new `PlanProposal` → diff
  against the live plan, bump `version`, **preserve already-`verified` steps** (re-plan only the
  unfinished frontier). Replan count bounded by `budget`; exhaustion → `failed` + surface.
- **Cancellation & pause.** `cancel(planId)` → running steps get their declared `rollback` in
  reverse dependency order (saga; reuses `AGENCY_MODEL` §8) → `compensating` → `cancelled`.
  `pause(planId)` → no new steps dispatched, in-flight run to their next verify then hold;
  `resume` continues. Both are audited `Command`s available from any trusted surface.
- **Approval gates** are `PlanStep.approvalGate`, set at RISK by `effectiveGate` (§9). Reaching
  one → `awaiting_approval` + Notification; **fail-closed** — the plan does not advance, and an
  unreachable approver keeps it paused. `hard_confirmation` additionally blocks auto-resume.
- **Plan ≠ authorisation.** Every `kind: 'capability'` step re-enters the Executor's full binding
  pipeline at dispatch. The plan's `riskAssessment`, `capabilityRequirements`, and preview
  verdicts are planning aids; the Executor re-derives risk, re-checks Policy + Permission, re-runs
  the freshness barrier.

---

## 9. Objective Engine, Action/Task/Objective, objective authority

### 9.1 Three distinct types

| | Is | Lives | Owned by |
|---|---|---|---|
| **`Action`** | one `CapabilityInvocationProposal` executed directly, no plan ("open Spotify") | the Executor invocation only | nothing persistent |
| **`Task`** | a bounded unit of work with a `Plan`, deadline, budget, outcome ("prepare tomorrow's meeting pack") | the interaction; `projections.cognition_runs` | Cognition Orchestrator |
| **`Objective`** | persistent desired-state pursuit across sessions / restarts, L2 ("increase qualified ScaleSmiths inbound leads") | forever | Objective Engine (#7) |

Relationship: `Objective` → decomposes to sub-`Objective`s + `Task`s → each `Task` has a `Plan` →
`Plan` steps are `Action`s.

### 9.2 Extended `Objective` (additive)

Existing fields + `owner`, `desiredState: DesiredStateSpec`, `successMetrics: SuccessMetric[]`,
`horizon: immediate|days|weeks|months|ongoing`, `constraints: string[]`,
`budget: ObjectiveBudget` (cost / agent-hours / wall-clock ceiling for autonomous pursuit),
`authority: ObjectiveAuthority`, `taskIds: Ulid[]`, `progress: { pct?, lastGapAssessment, trend }`,
`currentHypotheses: Hypothesis[]` (`{ statement, confidence, evidence, status: open|supported|refuted }`),
`nextEvaluation: Timestamp`.

`DesiredStateSpec.kind`: `world_model_predicate` (an ATLAS query + expected result),
`metric_target` (named metric + target + direction), `capability_state` (a capability `verify`
that should pass), `narrative` (prose → manual check, lowest tier). This makes "desired"
comparable to actual.

`SuccessMetric { id, statement, measure: DesiredStateSpec, current?: MetricReading, met: boolean }`.

### 9.3 Gap analysis — the engine's loop (Scheduler-driven at `nextEvaluation` cadence)

1. For each metric / predicate, query its authoritative source (ATLAS / a metrics source / a
   capability verify).
2. Compute `{ metric, desired, actual, gap, trend: closing|widening|stalled }`.
3. Update `progress` and `currentHypotheses` (a hypothesis is `supported` / `refuted` by later
   readings).
4. Gaps remain + objective `active` ⇒ emit `jarvis.kernel.objective.work_proposed`, stamped with
   the objective's `ObjectiveAuthority` → the Orchestrator picks it up as a new interaction,
   decomposes to a `Task`, plans, executes — **within the objective's ceiling and budget**.
5. All metrics `met` ⇒ `achieved`. Budget exhausted or a hard constraint hit ⇒ `blocked` + notify.

### 9.4 `ObjectiveAuthority` — a restrict-only ceiling, never a grant

```
ObjectiveAuthority {
  perCategory: {   // highest autonomy tier autonomous pursuit may reach, per action category
    research | analysis | internal_draft | code_branch:  'autonomous'
    deploy_staging:                                       'conditional'   // autonomous IF a named precondition holds
    deploy_production | external_comms | spending:        'approval'
    financial_action:                                     'hard_confirmation'
  }
  standingGrantScopes: string[]   // exact Permission Engine grant scopes autonomous pursuit may draw on
  hardConstraints:     string[]   // absolute — "never spend", "never touch prod"; checked first, at RISK
}
```

**Composition (the critical bit):** at RISK the Orchestrator maps each step's
`(capabilityId, action, riskClass)` to an action category and computes
`effectiveGate = strictest(policyPreview, objectiveCategoryGate)`.

- `autonomous` → step may proceed to EXECUTION (still subject to the Executor's **binding**
  Policy + Permission — if Policy says REQUIRE_APPROVAL it still does; the objective granted
  nothing).
- `conditional` → deterministic precondition predicate; pass → treat as `autonomous`; fail →
  `approval`.
- `approval` → forced approval gate regardless of Policy.
- `hard_confirmation` → approval gate + no auto-resume + typed confirmation on a trusted surface
  (= the Executor's CRITICAL dual-control path).

Objective authority can only make a step require **more**, never less. The Executor's binding
checks are entirely unaffected by it. `AUTONOMOUS` mode (ADR-0019) is orthogonal and also
restrict-only. **Only the Permission Engine grants permission, from its grants.** `hardConstraints`
are checked first: a matching plan step is refused at RISK, the objective → `blocked`, notify.

---

## 10. Budgets

### 10.1 `CognitiveBudget` — one shape at every level

```
CognitiveBudget {
  maxCostUnits?, maxAgents?, maxWallTimeMs?, maxToolCalls?, maxContextUnits?, maxModelCalls?
  localOnly?: boolean       // forces locality:'local' on every ModelRequest; no cloud egress
  deadline?: Timestamp      // absolute; overrides maxWallTimeMs if sooner
}
```

### 10.2 Hierarchy — each level bounded by its parent's *remaining*

```
Interaction budget  (Orchestrator sets it at INTENT)
  └─ Plan budget                 (≤ interaction remaining)
       └─ AgentAssignment budget  (≤ plan remaining, per lease)
            └─ ModelRequest.budget (≤ assignment remaining, per call)
       └─ SimulationRequest.budget (≤ plan remaining)
```

### 10.3 Where the interaction budget comes from (Orchestrator takes the `min` of all that apply)

- **Task-class default** — config table (`realtime_conversation` tiny; `deep_reasoning` large;
  `research` more agents).
- **Objective budget** — for `objective.work_proposed` interactions, the objective's
  `ObjectiveBudget` is a hard ceiling; its *remaining* balance decrements per interaction.
- **Explicit principal override** — a `Command` field ("spend up to £X", "answer fast").
- **Mode** — `DEGRADED` / `GUARDIAN` apply a config shrink factor + force `localOnly` where
  routing allows; `AUTONOMOUS` uses the objective budget only.
- **Operator caps** — an absolute per-day / per-interaction ceiling; never exceeded.

### 10.4 Enforcement — deterministic, three meters

- **Orchestrator** meters the interaction: before each stage, check remaining; a stage that would
  exceed → skipped / trimmed, interaction ends `status: budget_exhausted` with a partial result
  and the reason in the Timeline. Never a silent overrun.
- **Agent Runtime** meters each lease (`leasePolicy`): breach → kill →
  `AgentResult { status: 'budget_exhausted' }` with partial validated output.
- **Gateway** meters each `ModelRequest`: `maxCost` / `maxLatencyMs` / context overflow →
  `finishReason: 'error'`, `errorClass: 'budget_exceeded' | 'context_overflow'`.

`localOnly` is a hard routing filter — a `localOnly` interaction with no local model for a
required `taskClass` gets `errorClass: 'no_route'` and degrades to a templated / World-Model
answer rather than silently going to cloud.

Budgets are surfaced per step in the Cognitive Timeline and aggregated per objective.

---

## 11. Failure handling

Extends `FAILURE_MODEL.md` §2–§3. Every failure has a deterministic response and a coherent
terminal state — no crash, no silent pass, no infinite loop.

| Failure | Detected by | Response | Terminal state |
|---|---|---|---|
| **Model outage** | gateway circuit breaker | route to next `fallbacks[]`; else local; else `errorClass: 'no_route'` | Orchestrator degrades: templated answer from World Model / Memory, or defer + notify |
| **Rate limiting** | gateway (429 / provider signal) | exponential backoff within `deadline`; then fallback; mark provider `degraded` in the Registry | attempt recorded; succeeds on fallback or → outage path |
| **Provider degradation** | Registry EWMA threshold | `availability: 'degraded'`; routing score penalty, not hard-excluded | self-heals when metrics recover |
| **Malformed output** | Validator / Agent Runtime | `output_rejected`; stricter retry (same model) → different / stronger model → ask the principal | `failed` / `clarification_request` — malformed payload never enters the system |
| **Refusal** | `finishReason: 'filtered'` / `status: 'refused'` | one reframed retry → different model → surface with the reason | recorded `refused` outcome + note |
| **Timeout** | per-call (gateway) / lease (Runtime) / interaction `deadline` (Orchestrator) | kill the unit; keep usable partial validated output; advance or replan once within budget | `timed_out` at the level that fired |
| **Contradictory output** | Orchestrator | the §7 procedure; bounded rounds | `dominates` / `needs_principal` / `preserved_as_open` — never a blind average |
| **Tool hallucination** | Agent Runtime cross-checks `AgentResult.toolResults` / `evidence` refs vs the lease's mediated-tool log | mismatched refs stripped; dependent `result` → `status: failed`, `warning: evidence_mismatch`; repeat offender flagged for operator review | agent output rejected; Orchestrator re-dispatches or surfaces |
| **Cost / budget exceeded** | the three meters (§10) | stage skipped/trimmed; lease killed; call refused | `budget_exhausted` + partial result + reason |
| **Context overflow** | gateway pre-flight / Context Compiler | Compiler truncates to budget + lists `omitted`; still over → `long_context` model; else narrow the sub-question + follow-up frame | succeeds on a narrower frame / bigger model; never a silently-truncated call |
| **Worker crash** | Agent Runtime heartbeat / lease breach | `agent.failed` + partial validated output; free the workspace | `FAILURE_MODEL` §"Agent crashes" — no system state lost (L10) |
| **Orchestrator crash mid-interaction** | cold start finds a `cognition_runs` row with no terminal event | fold the interaction's `jarvis.cognition.*` events, resume at the last completed stage; `verified` steps not re-run; unresumable → `failed`, run declared step rollbacks, record | interaction resumed or cleanly failed |
| **Simulation failure** | Simulation Engine | `SimulationResult { status: 'failed' \| 'partial' }` + `caveats`; never fabricate numbers | caller gets an explicit partial/failed sim, not a wrong answer |

Cross-cutting guards (reaffirmed from `FAILURE_MODEL` §5): every gateway/agent/tool call timed +
circuit-broken; every queue bounded; Health Manager degradation gates behaviour (raises approval
requirements, prefers local, pauses non-essential autonomous work); no component blocks its loop
on another's synchronous response without a timeout + fallback.

---

## 12. Daedalus / Simulation Engine + counterfactual world state

**Simulation Engine (Daedalus)** — a new Kernel-internal protected service (ADR-0028,
Executor-class). Deterministic sequencing; **no write path to anything**. The `daedalus` specialist
frames a natural "what if" into a `SimulationRequest`; the Engine runs it; the agent may
*interpret* the result into an `AnswerProposal`, but the numbers and evidence classes come from
the Engine, never the model.

### 12.1 Contracts

```
SimulationRequest { id, correlationId, principalId, question, domain: SimulationDomainId, horizon,
  assumptions: Assumption[],
  counterfactual?: { worldModelSnapshotAt, overlay: FactOverlay[], scopeEntities: Ulid[] },
  budget: { costUnits, wallTimeMs, maxModelCalls }, determinismRequired?: boolean }

SimulationResult { requestId, status,
  assumptions,                            // echoed + any the engine added
  outputs: SimOutput[],
  overallConfidence,                      // = min of load-bearing outputs
  method: 'deterministic' | 'mixed' | 'model_dominated',
  sensitivities: [{ variable, deltaIn, deltaOut, elasticity }],
  caveats: string[], cost, timelineRef }

SimOutput { name, value, unit, evidenceClass, confidence,
  interval?: { low, high, kind: 'ci95' | 'range' | 'scenario_band' },
  derivation, dependsOnAssumptions }
```

### 12.2 Evidence-class discipline — never present speculative LLM output as precise simulation

| Class | Is | Confidence / interval |
|---|---|---|
| `DETERMINISTIC` | closed-form calculation over known inputs (`containers = ceil(rps / rps_per_container)`) | reflects input confidence only; no model |
| `STATISTICAL` | fit / forecast from a historical series with a stated method (regression, Holt-Winters, Monte Carlo) | real `ci95` |
| `HEURISTIC` | a named rule-of-thumb with an explicit stated assumption | interval = `range`; confidence capped ≤ 0.6 |
| `MODEL_GENERATED` | an LLM projection via the gateway | **always** tagged; confidence capped ≤ 0.5; `interval.kind: 'scenario_band'`; `caveats` carries "model estimate, not a computed result"; `determinismRequired: true` ⇒ Engine refuses it, returns `partial` |

An output's class is the **weakest** class of any input it depends on.

### 12.3 Counterfactual world state — isolation (never mutate real state)

- Read-only ATLAS snapshot via `AtlasQuery.believedAt(worldModelSnapshotAt)` for `scopeEntities`.
  No write path opened.
- `overlay: FactOverlay[]` (`set fact`, `add / remove relationship`, `remove entity`) applied to
  an **in-memory copy** held only in the sim's process scope for the run.
- The Engine emits **zero** `jarvis.world.*` events and never calls Knowledge Ingestion. It holds
  only an `atlas_query` read grant — structurally no `atlas.*` write credential.
- The `SimulationResult` is returned and recorded as a `DIAGNOSTIC` + `MEMORY_CANDIDATE` event —
  **not** a World Model fact. "Do it for real" is a separate objective / task with a real plan.
- ADR-0028 states the isolation guarantee + its test: run a counterfactual, assert no `atlas.*`
  row changed and no `jarvis.world.*` event emitted.

### 12.4 Domains this phase

Each is a `SimulationDomain` module `{ id, inputSchema, validate(assumptions),
run(snapshot, overlay, assumptions, budget) → SimOutput[] }`; new domains are modules, not Engine
changes.

1. `deployment_capacity` — deterministic: replicas / headroom / cost from RPS + per-unit
   throughput + SLO. **Worked reference domain.**
2. `infrastructure` — deterministic + statistical: utilisation projection, saturation date from a
   usage series.
3. `scheduling` / `resource_allocation` — deterministic constraint solving: do N tasks fit M
   workers by deadline; critical path.
4. `business_forecast` — statistical series forecast + heuristic growth assumptions + optional
   model-generated narrative. Runs against **fixtures** until real ScaleSmiths metrics land in
   ATLAS; `caveats` says so.
5. `pricing` — deterministic unit economics + heuristic elasticity + statistical where
   price / volume history exists.

---

## 13. Security & the "no model is authority" proof

### 13.1 Every point where model / agent output touches the system, and its gate

| Output | Channel | Gate | Authority it does NOT get |
|---|---|---|---|
| `ModelResponse` | gateway → caller | usage-metadata only persisted; content discarded unless a HIGH-risk logging capability is active | no store / capability / NATS reach |
| `AgentResult` | agent → Runtime control channel | validated against manifest + assignment `resultSchema`; tool-hallucination cross-check (§11); Runtime is sole event emitter | agent holds zero credentials; can't emit events, call the Executor, spawn sub-agents |
| `Proposal` | cognition → Validator | schema + safety + evidence-trust check; `derivedFromUntrusted` propagated | a `Proposal` is never an effect |
| `PlanProposal` → live `Plan` | Orchestrator promotion | sequenced through preview POLICY/RISK/PERMISSION; the Executor re-checks everything binding | the plan pre-authorises nothing |
| `CapabilityInvocationProposal` step | Orchestrator → Executor | full Executor pipeline: Validator → Policy → Permission → freshness barrier → simulate (≥HIGH) → execute → verify | can't skip a stage; CRITICAL always dual-control |
| `PolicyRecommendationProposal` | cognition → Policy Engine | **one typed input** to a rule; the decision function never calls a model, can't return the model's verdict verbatim (L21) | can't set / override a policy decision |
| `fact_extraction` candidates | Orchestrator → Knowledge Ingestion | re-validated; provenance + `epistemicStatus` mandatory; untrusted-derived capped at `retrieved` (ADR-0018 §4.3) | can't write a belief directly / as a strong one |
| `SimulationResult` | Engine → caller | recorded as `DIAGNOSTIC` / `MEMORY_CANDIDATE`, not a fact; Engine has only `atlas_query` read | can't mutate ATLAS or emit `jarvis.world.*` |
| interaction conclusions | Orchestrator → MNEMOSYNE candidate pipeline | scored by MNEMOSYNE's candidate gate, not auto-accepted | can't force a memory |

### 13.2 The seven "no model may…" invariants and their enforcement

| "No model may…" | Enforcement |
|---|---|
| change policy | Policy Engine is a pure function of typed inputs (L20); no rule can be "return the model's verdict" (L21); rules are versioned data written only by the Policy Engine. |
| grant itself permission | Only the Permission Engine mints authority tokens, from stored grants. The Orchestrator, agents, and the gateway hold none; none can request a scope wider than the objective's operator-set `standingGrantScopes`. |
| directly mutate authoritative state | Only Kernel components write `events` / `projections.*`. Agents and the gateway have no DB credential. Every state change is a validated `Command` handled by the owning component. |
| directly access unrestricted DB | Per-schema DB roles; agents get budgeted `atlas_query` / `memory_recall` **read** APIs via the Runtime's mediated channel — never a connection; no cross-schema `SELECT`. |
| self-install capabilities | Capabilities are manifests registered only by the Capability Registry after validation (L28); a `capability_invocation` proposal referencing an unregistered capability is a validation reject. |
| disable audit | The Audit Manager is read-only w.r.t. everything and derives its trail from the append-only Event Log; nothing suppresses an appended event. The Cognitive Timeline is a projection over that log. |
| bypass verification | `verify` is mandatory on every `CapabilityAction` (L22); "assumed success" is not a code path; the Orchestrator only advances a plan step on a `capability.verified` event it did not produce. |

### 13.3 The proof, stated once

Authority is held exclusively by (a) deterministic pure functions — the Policy Engine, the
routing function, the reconciliation procedure, the budget meters, the mode / authority-ceiling
composition; and (b) Kernel components / Executor-class services that are the sole writers of
their categories — State Manager, Objective Engine, Permission Engine, Knowledge Ingestion, Audit
Manager, Capability Executor, Cognition Orchestrator (sequencing only, no store). Models and
agents produce **only** `ModelResponse` / `AgentResult` / `Proposal` values on validated channels.

### 13.4 Sweep result — the mandate to find accidental authority

Three spots examined and closed in the design:

1. *Objective authority could have been a grant.* Closed: a **restrict-only ceiling** composed as
   `strictest(policyPreview, objectiveGate)`; never widens what Policy / Permission allow (§9).
2. *The Orchestrator's preview POLICY/RISK/PERMISSION could have been mistaken for the binding
   decision.* Closed: explicitly advisory; the Executor re-derives and re-checks everything at
   dispatch (§6, §8).
3. *A specialist could "simulate then apply".* Closed: the Simulation Engine has no write path and
   its result is not a fact; "apply for real" is a separate objective with a real plan (§12).

---

## 14. Deliverables

### 14.1 Contracts (`packages/contracts/src/`)

| File | Change |
|---|---|
| `model.ts` | + `TaskClass`, `reasoning`, `modalities`, `privacyClass`, `structuredOutput`, `latencyClass`, `minReliability`, `deadline`, `toolChoice`, `debug` on `ModelRequest`; `attempts[]` + `structuredOutputValid?` on `ModelResponse`; `ModelRegistration` extensions; `RoutingSnapshot`, `RoutingPlan`, `AttemptRecord`, `Modality`, `ReasoningLevel` |
| `routing.ts` | **new** — `RoutingPolicy` row, weight vectors, `FilterTrace`, `ScoreTrace` |
| `agent.ts` | **new** — `AgentManifest`, `AgentAssignment`, `AgentResult`, `ToolGrant`, `AgentTier`, worker ids |
| `plan.ts` | **new** — `Plan`, `PlanStep`, `RiskAssessment`, `Predicate`, status enums |
| `cognition.ts` | **new** — `PipelineStage`, `CognitionRun`, `DisagreementRecord`, `CognitiveBudget`, `IntentClassification` |
| `cognitive-timeline.ts` | **new** — `CognitiveTimelineEntry`, timeline / `why` query shapes |
| `simulation.ts` | **new** — `SimulationRequest`, `SimulationResult`, `SimOutput`, `EvidenceClass`, `Assumption`, `FactOverlay`, `Sensitivity`, `SimulationDomain` |
| `objective.ts` | + `DesiredStateSpec`, `SuccessMetric`, `ObjectiveBudget`, `ObjectiveAuthority`, `Hypothesis`, `ObjectiveProgress`, `GapAssessment`; extended `Objective` |
| `event-names.ts` | + `jarvis.cognition.*` step events (`intent.classified`, `context.assembled`, `plan.drafted`, `plan.modified`, `policy.evaluated`, `risk.assessed`, `permission.evaluated`, `step.dispatched`, `action.verified`, `world_update.proposed`, `memory_candidate.emitted`, `disagreement.recorded`), `model.call_failed`, `route.explained`, `agent.assigned` / `.completed` / `.failed`, `simulation.requested` / `.completed`, `jarvis.kernel.objective.work_proposed` |
| `index.ts` | barrel exports |

### 14.2 Schemas (migrations, distributed across sub-plans)

`0007_catalogue.sql` (`catalogue` schema: `models`, `routing_policy`, `model_health`);
`0008_cognition.sql` (`projections.cognition_runs`, `projections.agent_runs`);
`0009_objectives.sql` (event-sourced `objectives` + extended `projections.objectives` — objectives
are event-sourced per `STATE_MODEL` §4); `0010_cognitive_timeline.sql` (`audit.cognitive_timeline`);
`0011_simulation.sql` (`simulation.runs` replay log). All `principalId`-scoped; per-schema roles.

### 14.3 Services / modules

- `apps/gateway/src/` — `ProviderAdapter` interface + 2 adapters (a **keyless stub** for tests +
  one real-provider adapter shape); the routing function; per-provider circuit breakers; the
  streaming path for `realtime_conversation` / `speech_*`; the response cache.
- `apps/core/src/kernel/model-registry/` — Model Registry module (#11) + the `model_health`
  projector.
- `apps/core/src/kernel/agent-runtime/` — Agent Runtime module (#12) + `projections.agent_runs`
  projector.
- `apps/core/src/kernel/cognition-orchestrator/` — the Cognition Orchestrator service + the
  pipeline state machine + `projections.cognition_runs` + disagreement resolution.
- `apps/core/src/kernel/objective-engine/` — Objective Engine module (#7) + gap analysis + the
  authority-composition function.
- `apps/core/src/kernel/simulation/` — the Simulation Engine service + 5 `SimulationDomain`
  modules.
- `packages/agents/` — the agent worker harness (spawn, mediated channel, budget meter).
- `packages/validation/` — `Proposal`, `AgentResult`, `SimulationResult` validators.
- `agents/*/manifest.json` — all 11 specialist manifests upgraded to `AgentManifest`;
  `agents/workers/*` — 9 worker manifests.
- `apps/core/src/kernel/audit/` — the `cognitive_timeline` projector + `timeline()` / `why()`
  query API (extends the Audit Manager, #16).

### 14.4 ADRs

| ADR | Subject |
|---|---|
| `0024-cognition-orchestrator.md` | The Orchestrator as an Executor-class protected service (not a 17th frozen component); the pipeline; the Cognitive Timeline as an Audit Manager projection; the no-model-is-authority proof |
| `0025-model-routing-policy.md` | Routing as configurable data; the two-stage filter/score; `privacyClass` as a hard filter; override rules |
| `0026-agent-contract-and-tiers.md` | `AgentManifest` / `Assignment` / `Result`; specialist vs worker; the structured-`result` mandate; roster reassignment |
| `0027-objective-authority.md` | Objective authority as a restrict-only ceiling; Action / Task / Objective; composition with Policy / Permission / mode |
| `0028-simulation-engine.md` | Daedalus; the four evidence classes; counterfactual isolation guarantee; no write path |

### 14.5 Doc updates

- `COGNITION_MODEL.md` — major expansion: the Orchestrator, the pipeline, routing, the tier model,
  roster reassignment, budgets.
- New `docs/architecture/OBJECTIVE_MODEL.md` — objectives, `DesiredStateSpec`, gap analysis,
  objective authority, the autonomy loop.
- New `docs/architecture/SIMULATION_MODEL.md` — Daedalus, the evidence classes, counterfactual
  branching, domains.
- `KERNEL_CONSTITUTION.md` §1 — one paragraph noting the Cognition Orchestrator and the Simulation
  Engine as Executor-class protected internal services (mirrors the ADR-0020 Knowledge Ingestion
  note); no change to the frozen 16.
- `DATA_OWNERSHIP.md` §1 — new rows: routing policy + model health (Model Registry),
  `cognition_runs` (Cognition Orchestrator), `cognitive_timeline` (Audit Manager), extended
  objectives (Objective Engine), `simulation.runs` (Simulation Engine).
- `SECURITY_MODEL.md` — §13.1 sweep table + §13.2 seven enforcements.
- `FAILURE_MODEL.md` — the §11 cognition-failure table.
- `GLOSSARY.md` — Cognition Orchestrator, Cognitive Timeline, `TaskClass`, `RoutingPlan`,
  `AgentManifest` / `Assignment` / `Result`, specialist, worker, Action / Task / Objective,
  `ObjectiveAuthority`, `DesiredStateSpec`, gap analysis, `CognitiveBudget`, Daedalus, evidence
  classes, counterfactual branch, `DisagreementRecord`, effective gate.
- `ROADMAP.md` — MK.45 + MK.48 status; note the THE MIND spec; Daedalus / Cognitive Timeline are
  new material.
- New diagrams: `cognition-pipeline.mmd`, `model-routing.mmd`, `objective-loop.mmd`,
  `simulation-isolation.mmd`.

### 14.6 Implementation sub-plans (ordered)

| # | Sub-plan | Delivers | Depends on |
|---|---|---|---|
| 1 | **Model access** | gateway process, `model.ts` + `routing.ts`, Model Registry (#11), `catalogue` schema, 2 adapters, routing fn. ADR-0025. | — |
| 2 | **Agent runtime & tiers** | `agent.ts`, Agent Runtime (#12), worker harness, 20 manifests, Validator extensions. ADR-0026. | 1 |
| 3 | **Cognition Orchestrator** | `cognition.ts` + `plan.ts` + `cognitive-timeline.ts`, the Orchestrator service, the pipeline state machine, disagreement resolution, `cognition_runs`, `cognitive_timeline`. ADR-0024. | 1, 2, MK.44 stubs |
| 4 | **Objective Engine** | extended `objective.ts`, the engine (#7), gap analysis, authority composition, event-sourced objective tables. ADR-0027, `OBJECTIVE_MODEL.md`. | 3 |
| 5 | **Daedalus** | `simulation.ts`, the Engine, counterfactual branching, 5 domain modules, the `daedalus` agent. ADR-0028, `SIMULATION_MODEL.md`. | 1, 2, ATLAS query (MK.46 services) |

MK.44 (Policy Engine, Permission Engine, Capability Registry, Executor) is a **prerequisite** for
sub-plans 3–5 to run end-to-end; sub-plans 3–5 build against interface stubs of those and are
"complete" when their own logic + the stub-backed tests pass, mirroring how MK.46 foundation
built ahead of its consumers.

---

## 15. Testing

Suites per sub-plan (`@jarvis/testkit` ephemeral PG for anything persisted; the gateway's
**keyless stub adapter** for model paths — no real provider keys in tests).

| Area | Cases |
|---|---|
| Provider failure | primary adapter throws → advance to `fallbacks[0]`; `attempts[]` records both; `model.call_failed` emitted with `errorClass` |
| Provider switching | delete an adapter + its `catalogue.models` rows → same `ModelRequest` routes elsewhere with **zero contract / Kernel change** (the L3 proof); a `routing_policy` weight edit re-ranks with no deploy |
| Malformed model response | output fails `structuredOutput` schema → `output_rejected` → stricter retry → different model → `clarification_request`; malformed payload never reaches the Orchestrator or a store |
| Agent timeout | lease wall-time breach → `AgentResult { status: 'timed_out' }` + partial validated output; Orchestrator replans once within budget |
| Agent disagreement | two specialists, contradictory typed `result`s → `DisagreementRecord` with both positions + evidence; ordered procedure runs; categorical conflict never averaged; unresolved + blocking → `needs_principal`, interaction pauses fail-closed |
| Budget exhaustion | interaction `maxCostUnits` hit mid-plan → stage trimmed, `status: budget_exhausted`, partial result, reason in the Timeline; lease `maxCostUnits` → lease killed; `ModelRequest.maxCost` → `errorClass: budget_exceeded` |
| Plan cancellation | `cancel(planId)` mid-execution → running steps get declared `rollback` in reverse dependency order → `compensating` → `cancelled`; no half-applied unverified effect |
| Replanning | a step's `verify` fails → `status: replanning` → new `PlanProposal` → diff preserves already-`verified` steps, bumps `version`, re-plans only the frontier; replan count bounded → `failed` + surface at the cap |
| Objective suspension | `pause` an active objective → gap analysis skipped, in-flight tasks hold at next checkpoint; `resume` continues; no gap work proposed while paused |
| Objective completion | all `successMetrics` read `met` at a gap assessment → `achieved` emitted, no further work proposed, budget balance frozen |
| Simulation isolation | counterfactual with a `FactOverlay` → assert **no `atlas.*` row changed** and **no `jarvis.world.*` event emitted**; the Engine's DB role has no `atlas` write privilege; result recorded as `DIAGNOSTIC` / `MEMORY_CANDIDATE`, not a fact |
| Policy boundary | `PolicyRecommendationProposal: ALLOW` on a step Policy rules `DENY` → denied (recommendation is one input, L21); objective `authority: autonomous` on a step Policy `REQUIRE_APPROVAL` → still requires approval (`effectiveGate = strictest`) |
| Tool hallucination | `AgentResult` cites an `evidence` / `toolResults` ref not in the lease's mediated-tool log → stripped; dependent `result` → `status: failed`, `warning: evidence_mismatch`; repeat offender flagged |
| Context overflow | frame exceeds model limit after Compiler budgeting → route to `long_context` model; else narrow the sub-question + follow-up frame; never a silently-truncated call |
| Evidence-class honesty | a `SimOutput` whose deterministic formula consumed a `MODEL_GENERATED` input is itself `MODEL_GENERATED`; `determinismRequired: true` + a model-only path → `status: partial`, output withheld |
| Orchestrator crash recovery | kill the Kernel mid-interaction → cold start folds `jarvis.cognition.*` for the open `correlationId`, resumes at the last completed stage, does not re-run `verified` steps |
| Routing privacy gate | `ModelRequest.privacyClass: RESTRICTED` with only cloud models for the `taskClass` → `errorClass: no_route` (never silently cloud-routed); `debug.forceModelId` of a model failing the privacy filter → `errorClass: override_rejected` |

### Closing boundary review (written into ADR-0024, re-verified by tests) — "find accidental authority"

1. **Model output ≠ decision.** No Kernel / Orchestrator code path branches on raw model text;
   every branch is on a validated typed field. The Policy decision function has no gateway import.
2. **Agent ≠ state owner.** Agent processes hold no DB / NATS / provider credential (env + role
   check); the Agent Runtime is the sole emitter of events on agent output; `projections.agent_runs`
   is Runtime-written only.
3. **Orchestrator ≠ authority.** It writes only `projections.cognition_runs` and emits
   `jarvis.cognition.*`; holds no capability credential, mints no authority; its
   POLICY / RISK / PERMISSION stages are advisory — the Executor re-checks binding.
4. **Objective authority ≠ grant.** `effectiveGate = strictest(policyPreview, objectiveGate)`;
   a test asserts it can only add gates, never remove one.
5. **Simulation ≠ world change.** No write path; result is not a fact; isolation test above.
6. **Cognitive Timeline ≠ new authority / ≠ chain-of-thought store.** An Audit Manager projection
   over the append-only log; `summary` fields are operational facts; a test asserts no model
   reasoning-token content is persisted.

Any of these failing a test is a design defect fixed before the sub-plan merges — not a discipline
note.

---

## 16. Open risks (tracked, not blocking)

- **Built ahead of MK.44.** Sub-plans 3–5 build against interface stubs of Policy / Permission /
  Executor. Risk: stub shapes diverge from the real MK.44. Mitigated: the contracts those stubs
  implement (`policy.ts`, `permission.ts`, `capability.ts`) already exist and are the binding
  interface; MK.44 implements them, it does not redefine them.
- **`daedalus` domain data.** `business_forecast` / `pricing` need real ScaleSmiths metrics in
  ATLAS, which don't exist yet. Mitigated: domains run against fixtures; `caveats` say so; the
  Engine + evidence-class discipline are what this phase proves.
- **Routing `qualityPrior` is operator-set.** No automated quality learning until an eval harness
  exists (deferred). Mitigated: conservative defaults; the projection already learns
  reliability + latency from real call outcomes.
- **Roster reassignment** touches `COGNITION_MODEL` §6 + 3 manifests. Low risk — no code depends
  on the current role text; the change is documentation + manifest data.
- **Cognitive Timeline volume.** One projection row per pipeline step per interaction. Mitigated:
  `DIAGNOSTIC` retention (14 d) for the step events; the projection itself is bounded by
  interaction count (human-scale) and follows the Audit Manager's partition + cold-storage policy.
