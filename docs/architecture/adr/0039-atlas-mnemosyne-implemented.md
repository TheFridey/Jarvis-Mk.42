# ADR-0039: ATLAS + MNEMOSYNE implemented — runtime locations and boundaries

Status: Accepted
Date: 2026-09-08
Deciders: Principal Knowledge Architect

## Context

ADR-0020–0023 and `ATLAS_MODEL.md` / `MNEMOSYNE_MODEL.md` specified the temporal
world model (ATLAS) and memory (MNEMOSYNE) in full. `AUDIT_MK42_ASCENSION_II.md`
(§"ATLAS and MNEMOSYNE are vaporware relative to their documentation weight")
then established that only the contracts and the SQL migrations existed:
`packages/world-model` and `packages/memory` held nothing but `README.md`, the
Context Compiler never consulted a world model or a recall service, and
ADR-0022 / ADR-0023 had no implementing code. The audit's condition was: build
them for real, or descope and rewrite the docs.

This ADR records the decision to build, and — because the repository evolved
away from the `packages/*` layout that ADR-0020 assumed — where the runtime
actually lives.

## Decision

- **ATLAS and MNEMOSYNE are implemented as Kernel-internal code**, not as the
  `packages/world-model` / `packages/memory` libraries ADR-0020 named. This
  matches how cognition, the objective engine, voice, and vision evolved
  (`MK43_IMPLEMENTATION_NOTES.md`): the modular monolith is one deployable and
  the "package" seam is a README pointer plus an extraction boundary, not a
  build unit.

  | Concern | Location |
  |---|---|
  | ATLAS runtime | `apps/core/src/kernel/atlas/` — `AtlasStore`, `AtlasQueryService`, `EntityResolver`, `reviseBelief`, `ObservationPromoter` |
  | MNEMOSYNE runtime | `apps/core/src/kernel/mnemosyne/` — `MnemosyneStore`, `MemoryRecallService`, `scoreCandidate`/`decideDisposition`, `Consolidator`, borrowed-class readers |
  | Knowledge Ingestion mediator (sole writer) | `apps/core/src/kernel/knowledge/knowledge-ingestion.ts` |
  | Event → candidate | `apps/core/src/kernel/knowledge/candidate-source.ts` |
  | Agent-facing bounded interface | `apps/core/src/kernel/knowledge/agent-facade.ts` |
  | Embedding port + deterministic impl | `apps/core/src/kernel/embedding/` |
  | Context Compiler fusion | `apps/core/src/kernel/context/context-compiler.ts` |
  | Schemas | `packages/persistence/src/migrations/0005_atlas.sql`, `0006_mnemosyne.sql` (unchanged) |
  | Contracts | `packages/contracts/src/{entity,fact,observation,causal,atlas-query,memory,memory-candidate,memory-insight,memory-recall,knowledge-ingestion,knowledge-agent,embedding}.ts` |

- **Every ADR-0020 boundary is preserved.** Two schemas, two read services
  (`AtlasQuery`, `MemoryRecall`), one writer (`KnowledgeIngestion`). Neither
  read service calls the other; the Context Compiler is the only fuser.
  Consolidation is a Scheduler routine that emits proposals through the mediator
  and writes only its own `consolidation_runs` audit log.

- **Embeddings: deterministic, model-free, offline** (`DeterministicEmbeddingClient`,
  `deterministic-hash-v1`). ADR-0011's pgvector stays; ADR-0023's `w_sim` is
  additionally hard-capped in `applyWeightBounds`. A model-backed adapter is a
  drop-in replacement behind `EmbeddingClient`; every stored vector records its
  `modelId`.

- **Privacy-aware cognition routing.** The Context Compiler computes
  `ContextPackage.maxPrivacyClass` over the kept items. The cognition
  orchestrator compiles at a wide ceiling, then routes: `SENSITIVE` /
  `RESTRICTED` context forces `locality: 'local'` + `cloudAllowed: false`; a
  `RESTRICTED` package with no policy-permitted local route (`config.modelLocalRouteAvailable`)
  **fails closed** rather than downgrading. Sensitivity labels are never stripped.

- **Agents (ORACLE / SCOUT / FORGE)** reach the plane only through
  `KnowledgeAgentFacade`: bounded `query` / `explain` (read), and `propose`
  (write) which downgrades every proposal (`derivedFromUntrusted = true`,
  epistemic status capped to `inferred`/`derived`/`predicted`, causal ladder
  capped at `hypothesised_cause`, confidence capped) and routes it through the
  mediator. No agent holds a store reference.

- **New scheduled routines:** `knowledge.harvest` (2 min — event→candidate +
  observation→fact promotion + observation expiry) and `memory.consolidate`
  (6 h — DREAMING). Both are also exposed on `KernelHandle`
  (`harvestKnowledge()`, `consolidateMemory()`) for explicit operator/test
  triggering.

## Alternatives considered

- **Build inside `packages/world-model` / `packages/memory` as ADR-0020 wrote.**
  Rejected: the NestJS-per-package structure was abandoned at MK.43
  (`kernel.ts` is a plain composition root); every peer subsystem shipped since
  lives under `apps/core/src/kernel/*`. Following the dead layout would have
  produced a second, inconsistent wiring style and a package the monolith
  imports across its own boundary.

- **Model-backed embeddings via the Model Gateway now.** Rejected for this
  phase: adds a live model dependency to a Kernel read/write path and makes
  belief revision and tests non-deterministic. Deferred behind the port.

- **Loosen the cognition privacy pin instead of routing.** Explicitly rejected
  by the brief: the fix is correct routing + fail-closed, not label loosening.

## Consequences

- `packages/{world-model,memory,context}/README.md` rewritten as pointers to the
  runtime locations.
- `packages/contracts` gains `embedding.ts`, `knowledge-agent.ts`; `context.ts`
  gains ATLAS/MNEMOSYNE `ContextItemKind`s, `ContextSourceType`,
  `ContextPackage.maxPrivacyClass` + `.freshness`; `event-names.ts` gains the
  remaining `jarvis.world.*` / `jarvis.memory.*` names.
- `config.ts` gains `modelLocalRouteAvailable` and a `knowledge` block (recall
  weights, consolidation caps, promotion thresholds).
- `DiagnosticsService` reports real `world-model` and `memory-subsystem`
  dependency rows (counts, open conflicts, last consolidation) instead of the
  `placeholder: true` stubs.
- `ATLAS_MODEL.md` §1, `MNEMOSYNE_MODEL.md` §1, `WORLD_MODEL.md`,
  `STATE_MODEL.md` §Memory, `DATA_OWNERSHIP.md` §1, `COGNITION_MODEL.md` §4,
  `README.md` "Current status" updated to point at the implemented reality.

## Reversal difficulty

**Moderate.** The two `apps/core/src/kernel/{atlas,mnemosyne}` trees, the
`knowledge` mediator, the embedding port, and the Context Compiler / cognition
edits are additive; the frozen 16 are untouched. Backing out means deleting
those trees, reverting the Context Compiler to the state-slices-only path, and
dropping the `atlas` / `mnemosyne` schemas.
