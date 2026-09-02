# ADR-0023: Memory retrieval ranking — seven factors, similarity bounded

Status: Accepted
Date: 2026-09-01
Deciders: Principal Architect / Knowledge Architect

## Context

Naive vector recall ranks purely by cosine similarity, which lets the embedding model dictate what JARVIS "remembers as relevant" — and, worse, invites treating the nearest vector as the true answer. MNEMOSYNE recall must combine more than embeddings and must never let similarity alone decide.

## Decision

- Recall is **always** `top-k` with a **relevance floor** — never "all relevant".
- Relevance is a weighted composite of **seven** factors, computed in one SQL query over pgvector + scalar columns: semantic similarity, entity overlap, recency decay, importance (salience), objective relevance, confidence, source authority.
- **`w_sim` (the similarity weight) is bounded** in config so similarity alone cannot dominate the composite.
- Weights live in config and are **logged with every recall** (returned as `weightsUsed`) for tuning.
- Contradiction resolution in ATLAS **never** consults embeddings — that is belief revision by authority ranking and recency (ATLAS_MODEL.md), a separate mechanism.
- This ADR **complements** ADR-0011 (pgvector stays; it is one factor here), it does not supersede it.

## Alternatives considered

- **Pure cosine similarity + `top-k`.** Rejected: embedding model becomes the arbiter of relevance and truth.
- **A learned re-ranker model.** Rejected for MK.46: no training data, adds a model dependency to a Kernel read path, non-deterministic. Revisit later.
- **Hard pre-filters only (entity, recency) then cosine.** Rejected: too brittle — a relevant episode with no entity tag falls off a cliff. Weighted blend degrades gracefully.

## Benefits

- Similarity is a contributor, not a dictator.
- Deterministic and explainable — the `weightsUsed` payload plus the per-factor breakdown answers "why did you recall that".
- Tunable without code change.

## Disadvantages

- Seven weights to tune with no ground truth yet. Mitigated: conservative defaults (favour precision), logged, adjustable.

## Risks

- **Weight misconfiguration silently degrades recall.** Mitigated: `weightsUsed` in every response; a diagnostics view can surface the current weights.
- **pgvector recall quality at growth.** Mitigated per ADR-0011: recall is behind the `MemoryRecall` interface; swapping the similarity engine is an adapter + sync path, not a schema redesign.

## Consequences

- `packages/contracts/src/memory-recall.ts` — `MemoryRecall`, `RecallQuery`, `RecallWeights`, `RecalledItem`.
- Recall weights added to Kernel config (later plan).
- `MNEMOSYNE_MODEL.md` §Retrieval documents the formula.

## Reversal difficulty

**Low.** The formula lives in one query builder behind `MemoryRecall`. Changing the factor set or weights is a localised change; callers are unaffected.
