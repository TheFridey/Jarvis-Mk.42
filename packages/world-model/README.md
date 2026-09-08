# @jarvis/world-model

> **MK.46 status — IMPLEMENTED, but not here.** The runtime for ATLAS lives in
> the Kernel modular monolith, not in this package. The audit
> (`docs/architecture/AUDIT_MK42_ASCENSION_II.md`) confirmed this package was a
> README-only seam; the MK.46 knowledge plan built ATLAS as Kernel-internal
> code, mirroring how cognition / objective / voice / vision evolved.
>
> **Where the code is:**
> - `apps/core/src/kernel/atlas/` — `AtlasStore` (all `atlas.*` SQL),
>   `AtlasQueryService` (temporal read API), `EntityResolver`,
>   `reviseBelief` (supersession + conflict, never silent overwrite),
>   `ObservationPromoter` (observation → fact evaluator).
> - `apps/core/src/kernel/knowledge/knowledge-ingestion.ts` — the **only**
>   writer to `atlas.*` (ADR-0020).
> - `packages/persistence/src/migrations/0005_atlas.sql` — the `atlas` schema.
> - `packages/contracts/src/{entity,fact,observation,causal,atlas-query}.ts` —
>   the shared types.
>
> Governance is unchanged: `docs/architecture/ATLAS_MODEL.md`, ADR-0020,
> ADR-0021, ADR-0039. This package is kept as a pointer and an extraction seam:
> when the knowledge plane is lifted into its own service it takes this name.

**Owns (schema).** `atlas` — `entities`, `entity_aliases`,
`entity_relationships`, `facts`, `facts_archive`, `evidence`, `conflicts`,
`observations`, `causal_hypotheses`; per-schema DB role `jarvis_atlas`.

**Must not.** Store conversation transcripts or episodic narrative (that is
MNEMOSYNE). Accept a fact without provenance / confidence / epistemic status.
Resolve a conflict by silent overwrite. Be written by anything except the
Knowledge Ingestion mediator. Grow without bound (the archival move to
`facts_archive` is mandatory). Present a causal hypothesis as an established
cause.

**Extraction seam.** → the knowledge service (with `@jarvis/memory`).
