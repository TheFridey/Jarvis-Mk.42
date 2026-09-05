# Cognition Model

Where intelligence lives — and why it is not JARVIS (L1, L3, L26). Covers the
Model Gateway, provider replaceability, reasoning/planning, agents, proposals,
and the context budget that prevents context explosion.

Subordinate to [`PRINCIPLES.md`](PRINCIPLES.md).

---

## 1. Position

Cognition is a **replaceable computational resource**. It:

- consumes `ContextFrame`s from the Kernel;
- produces `Proposal`s (answers, plans, drafts, policy recommendations,
  suggested capability invocations);
- holds **no credentials** for authoritative stores or capabilities;
- causes **no effects**;
- is **untrusted** until its output passes the Validator (L30).

Everything that makes JARVIS *JARVIS* — identity, state, memory, world model,
objectives, policy, permission, audit — is elsewhere and does not depend on any
model.

## 2. The Model Gateway (`apps/gateway`)

**MK.42 implementation status:** operational. The standalone gateway owns the
OpenAI, Anthropic, and local OpenAI-compatible wire adapters, routing, health,
timeouts, cancellation, usage/cost accounting, and circuit breakers. Core sees
only the provider-neutral `ModelGatewayPort` and contracts.

Single egress to all inference. Separate process (holds provider keys, does
slow network IO, must fail independently of the Kernel — L26, blast radius).

### 2.1 Contracts (`packages/contracts/src/model.ts`)

```
ModelRequest {
  task           string        -- "reason" | "plan" | "summarize" | "extract"
                              --   | "classify" | "code" | "embed" | "transcribe" | ...
  capabilities   string[]      -- required model capabilities (e.g. "tools", "vision", "json")
  input          ModelInput    -- STRUCTURED (see §2.3), never provider "chat" shape
  budget: {
    contextUnits number         -- abstract; adapter maps to provider tokenizer
    maxOutput    number
    maxCost?     number          -- currency units
    maxLatencyMs?number
  }
  locality       "local" | "prefer-local" | "any" | "cloud-ok"
  determinism?   "strict" | "low-temp" | "creative"
  correlationId  string
  principalId    string
}

ModelResponse {
  modelId        string
  output         ModelOutput
  usage: { contextUnits, outputUnits, costEstimate, latencyMs }
  finishReason   "stop" | "length" | "filtered" | "error"
  provenance     Provenance
}
```

### 2.2 Routing

The gateway selects a model using **Model Registry** metadata (declared
capabilities, context limit, cost/unit, locality, current health) + a routing
policy:

1. Filter to models matching `capabilities` and `locality`.
2. Rank by: honour `determinism`, fit `budget`, minimise cost, then latency,
   then a quality prior per task class.
3. Apply circuit-breaker/health: skip degraded providers.
4. On failure: retry once on the next-best model; then return `finishReason:
   error` — cognition handles it (§5), the Kernel never crashes.

### 2.3 No provider shapes in Kernel contracts (review §16.6)

`ModelInput` is structured: `{ instruction, context: ContextFrame,
constraints, examples? }`. The **adapter** turns that into whatever the
provider wants (chat messages, a completion string, a tools schema). The Kernel
and Cognition packages never mention "system/user/assistant", never count
provider-specific tokens, never import a provider type.

### 2.4 What the gateway persists

Only: `jarvis.cognition.model.called` events with `usage`, `modelId`,
`task`, `correlationId` — **no prompt/response content by default**. An opt-in
per-request `cacheable: true` stores the response in a TTL'd cache keyed on a
request hash. Content logging is a HIGH-risk capability, off by default.

## 3. How providers are replaced (L3) — concretely

| Step | Action | Touches |
|---|---|---|
| 1 | Write an adapter implementing `ProviderAdapter` (one `invoke(ModelRequest, modelMeta) → ModelResponse`) | `apps/gateway/src/adapters/<name>` |
| 2 | Register its models | `catalogue.models` rows (data) |
| 3 | Adjust routing defaults if desired | routing policy (data/config) |
| To remove a provider | delete adapter + rows | same two places |

**Never touched:** Kernel components, `packages/contracts`, World Model,
Memory, Policy, Permission, Capabilities, Events, Objectives, Audit, any
Experience surface. That invariance is the proof of L3.

Local models (llama.cpp / vLLM / Ollama endpoint) are just adapters with
`locality: local` registry entries (L36).

## 4. Context Compiler & the context budget (review §16.12)

The Context Compiler (Kernel component) builds every `ContextFrame`.

### 4.1 `ContextFrame` (`packages/contracts/src/context-frame.ts`)

```
ContextFrame {
  task           { statement, class }        -- what cognition must do
  objectives     ObjectiveRef[]              -- active, relevant
  facts          ScoredFact[]                -- from World Model, time-scoped
  observations   ObservationRef[]            -- recent, relevant signals
  recall         Episode[]                   -- top-k Memory, relevance >= floor
  unknowns       Unknown[]                   -- explicit "no information on X" (L17)
  scene?         SceneSlice                  -- spatial context if relevant (L33)
  constraints    string[]
  budget         { contextUnits, filled, truncated: boolean, omitted: string[] }
  freshness      { worldModelAsOf, memoryAsOf }
  correlationId  string
}
```

### 4.2 Budgeting — hard bound, priority tiers

Every frame has a **context-unit budget** derived from the task class and the
target model's limit. The Compiler fills it by descending priority:

1. Task statement + explicit constraints.
2. Active objective(s) and their success criteria.
3. High-confidence, directly-relevant World Model facts (time-scoped).
4. Recent relevant observations (aggregated, not raw).
5. Top-k Memory episodes above the relevance floor.
6. Supporting/second-degree facts.

It **stops at the budget** and records what was dropped in `budget.omitted` +
`budget.truncated = true`. Recall is `top-k` with a relevance floor — never
"all relevant memories". No unbounded joins. If cognition needs more, it asks
for a **follow-up frame** scoped to a narrower sub-question rather than one
giant frame.

This is the single most important guard against cost blow-up and reasoning
degradation in a system like this.

## 5. Reasoning, planning, synthesis

- Consume a `ContextFrame`, call the gateway, produce a `Proposal`.
- **Planning** produces a typed `Plan` (ordered steps, each a proposed
  capability invocation or sub-question, with preconditions and expected
  effects). The Executor and Policy Engine gate each step at execution time —
  the plan is a proposal, not an authorisation.
- **Simulation** (as a cognitive activity) runs "what if" reasoning and may
  request capability `simulate` runs (`AGENCY_MODEL.md`) to ground its
  predictions.
- **Synthesis / analysis / research** produce documents or structured findings
  as `Proposal`s; anything they assert about the world goes through World Model
  ingestion with `epistemicStatus` and evidence.

### Malformed / rejected output (review §16.9, FAILURE_MODEL)

Validator rejects a `Proposal` (bad schema, unsafe content, evidence chain
failure) ⇒ emit `jarvis.cognition.output_rejected` ⇒ bounded retry with a
stricter instruction ⇒ fall back to a simpler/cheaper model ⇒ fall back to
asking the principal. Never a crash, never a silent pass.

## 6. Agents (`agents/*`)

Disposable workers (L9, L10). The Agent Runtime (Kernel) spawns one with:

- a **lease** (id, TTL, budget cap in cost + context units + wall time);
- a **scoped `ContextFrame`**;
- a **capability scope** (the subset of capabilities it may *propose*, and the
  workspace it may use);
- **no credentials** for DB, NATS, providers (it reaches the gateway only via
  the Runtime's mediated channel, which stamps `onBehalfOf`).

Agent output returns to the Runtime over a control channel as `Proposal`s /
`Observation`s. **The Runtime emits the events**, after validation (review
§16.7). Agents cannot publish to NATS, cannot call the Executor, cannot spawn
sub-agents except by asking the Runtime.

### The named roster

| Agent | Job |
|---|---|
| `oracle` | General reasoning / question answering over compiled context |
| `forge` | Software implementation (proposes filesystem/terminal/github/docker invocations) |
| `scout` | Research / retrieval / source gathering (web content tagged untrusted) |
| `argus` | Monitoring / watch tasks / anomaly surfacing over telemetry & events |
| `hermes` | Communications drafting & delivery (proposes `communications` invocations) |
| `sentinel` | Security review, policy-recommendation drafting, risk analysis |
| `atlas` | Data analysis / quantitative synthesis |
| `mnemosyne` | Memory curation: summarisation, episode linking, decay proposals |
| `prometheus` | Planning / foresight / objective decomposition support |
| `daedalus` | Design & architecture reasoning; simulation scenario construction |
| `hephaestus` | Build/infra automation authoring (proposes docker/infra invocations) |

Every one of them is *disposable*. Killing any agent mid-run loses no system
state; the Runtime records the lease outcome and cognition can retry.

## 7. What Cognition must never do

- Hold credentials or call a provider directly (only via the gateway).
- Write authoritative state, the World Model, or Memory.
- Emit events directly (agents return to the Runtime; reasoning returns
  `Proposal`s).
- Make or override a policy decision (L21) — it may emit a
  `PolicyRecommendation` the Policy Engine reads as one input.
- Execute a capability — it *proposes*; the Executor gates.
- Receive an unbounded context — every frame is budgeted.
