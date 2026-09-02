# ADR-0022: Memory consolidation ("DREAMING")

Status: Accepted
Date: 2026-09-01
Deciders: Principal Architect / Knowledge Architect

## Context

MNEMOSYNE must compress repetition, merge duplicates, promote durable knowledge, strengthen supported knowledge, decay stale assumptions, surface contradictions, update procedures, and propose cross-domain links — offline, on a schedule. The internal nickname is "DREAMING". It is knowledge consolidation, not consciousness, and it must not become a back door for an LLM to write beliefs.

## Decision

- Consolidation is a **Scheduler routine** (`memory.consolidate`, off-peak cadence), not a Kernel component and not an autonomous agent loop.
- It **reads** events, episodes, candidates, objective progress, procedures, and working memory; it **produces proposals only**, routed back through Knowledge Ingestion. It never writes `atlas.*` or `mnemosyne.*` directly.
- **Every generated insight retains evidence/provenance.** A consolidation output with no evidence chain is rejected at ingestion (and by the `insights_evidence_nonempty_ck` constraint).
- Until the Agent Runtime exists (MK.45), the routine runs **deterministic rules only**. After MK.45 it may invoke the `mnemosyne` agent for summarisation and linking — the agent still only proposes.
- `mnemosyne.consolidation_runs` records every pass (inputs scanned, proposals emitted, outcomes) for audit.

## Alternatives considered

- **A continuously-running background service.** Rejected: consolidation is batch work with no latency requirement; a routine on the existing Scheduler costs nothing extra and inherits pause-when-degraded.
- **Let the `mnemosyne` agent write memory directly during consolidation.** Rejected: violates L10 (agents own no authoritative state) and the single-writer rule (ADR-0020).
- **Generate insights speculatively to seem intelligent.** Explicitly rejected: the surfacing gate requires real, evidence-backed, threshold-significant, context-relevant, not-already-surfaced insights. Zero insights is normal.

## Benefits

- Reuses the Scheduler's degradation handling and tick observability.
- The proposals-only rule keeps the single-writer boundary intact.
- Deterministic-first means MK.46 ships a working (if modest) consolidator with no model dependency.

## Disadvantages

- Deterministic rules produce shallow insight until MK.45. Accepted — the pipeline, provenance discipline, and surfacing gate are what MK.46 proves.

## Risks

- **Consolidation storms** (a pass proposing thousands of writes). Mitigated: a per-run proposal cap in config; `consolidation_runs` records the count; overflow defers to the next run.
- **Decay removes something still true.** Mitigated: decay only lowers confidence on `inferred`/`predicted` facts that are stale AND uncorroborated; below-floor facts move to `expired` status (archived, recoverable), never hard deleted.

## Consequences

- A `memory.consolidate` routine registered with the Scheduler (later plan).
- `EventNames.MemoryConsolidationCompleted` = `jarvis.memory.consolidation.completed`.
- `mnemosyne.consolidation_runs` and `mnemosyne.insights` in migration `0006`.
- `MNEMOSYNE_MODEL.md` §Consolidation and §Morning Insight.

## Reversal difficulty

**Low.** Delete the routine registration and the two tables; MNEMOSYNE still functions as an append + recall store without consolidation.
