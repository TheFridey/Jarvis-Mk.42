# ADR-0021: Causal hypothesis model — foundations only

Status: Accepted
Date: 2026-09-01
Deciders: Principal Architect / Knowledge Architect

## Context

JARVIS needs a place to record "deployment A may have caused latency increase B, confidence 0.78, evidence X/Y/Z" without ever presenting correlation as proven causation. MK.46 is not the phase to build causal inference; it is the phase to fix the representation and the write discipline so later phases have somewhere sound to write.

## Decision

- A single table `atlas.causal_hypotheses` with a four-rung `relationKind` ladder: `chronological` < `correlated` < `hypothesised_cause` < `established_cause`.
- **Write discipline:** cognition proposals may reach at most `hypothesised_cause`. `established_cause` is writable only by (a) an explicit principal assertion, or (b) a deterministic derivation with named rule support. Knowledge Ingestion enforces this ceiling.
- Every hypothesis carries `confidence`, `evidence[]` (non-empty), `method`, and temporal validity.
- The `AtlasQuery.causal()` API returns `relationKind` verbatim; no consumer may collapse the ladder.
- **No causal-inference engine this phase.** Only the typed store and the ingestion ceiling.

## Alternatives considered

- **A generic `entity_relationships` row of type `caused`.** Rejected: loses the distinction between chronology, correlation, hypothesis, and established cause; invites exactly the "correlation presented as causation" error.
- **A separate causal graph database.** Rejected per ADR-0011 reasoning — no benchmarked need at MK.42 scale; recursive SQL suffices for the read patterns MK.46 has (there are none yet beyond "hypotheses touching ref X").
- **Deferring the table entirely to a later MK.** Rejected: later phases will produce causal guesses regardless; without a sound store they would land as untyped facts or free text, which is worse.

## Benefits

- Correlation can never be silently promoted to cause — the ladder is a schema CHECK constraint plus an ingestion ceiling.
- Later causal-inference work has a fixed, evidence-bearing target.
- Zero cost to the rest of the system this phase (one inert table).

## Disadvantages

- A table with no writer until a later phase wires the promotion evaluator and cognition proposals. Accepted — foundations by definition.

## Risks

- **A future implementer writes `established_cause` from model output.** Mitigated: the ingestion ceiling is enforced in Knowledge Ingestion with a test; this ADR is cited in that code.
- **The ladder is too coarse.** Mitigated: `relationKind` is an open-ish enum guarded by a CHECK; adding a rung is a migration + this ADR, not a redesign.

## Consequences

- `packages/contracts/src/causal.ts` — `CausalHypothesis`, `RelationKind`.
- `atlas.causal_hypotheses` in migration `0005`.
- `EventNames.WorldCausalHypothesised` = `jarvis.world.causal.hypothesised`.
- `ATLAS_MODEL.md` §Causal hypotheses documents the ladder and discipline.

## Reversal difficulty

**Low.** One table, one contract file, one event name. Nothing depends on it yet.
