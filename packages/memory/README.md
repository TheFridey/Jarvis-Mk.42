# @jarvis/memory

> **MK.46 status — IMPLEMENTED, but not here.** The runtime for MNEMOSYNE lives
> in the Kernel modular monolith. This package was a README-only seam (see
> `docs/architecture/AUDIT_MK42_ASCENSION_II.md`); the MK.46 knowledge plan
> built MNEMOSYNE as Kernel-internal code.
>
> **Where the code is:**
>
> - `apps/core/src/kernel/mnemosyne/` — `MnemosyneStore` (all `mnemosyne.*`
>   SQL), `MemoryRecallService` (the seven-factor composite, ADR-0023),
>   `scoreCandidate` / `decideDisposition` (the candidate gate),
>   `Consolidator` (DREAMING — deterministic, proposals-only, ADR-0022),
>   `WorkingMemoryReader` / `SessionMemoryReader` (borrowed classes).
> - `apps/core/src/kernel/knowledge/knowledge-ingestion.ts` — the **only**
>   writer to `mnemosyne.*` and the `ConsolidationSink` DREAMING proposes to.
> - `apps/core/src/kernel/knowledge/candidate-source.ts` — event → candidate.
> - `packages/persistence/src/migrations/0006_mnemosyne.sql` — the schema.
> - `packages/contracts/src/{memory,memory-candidate,memory-insight,memory-recall}.ts`.
>
> Governance: `docs/architecture/MNEMOSYNE_MODEL.md`, ADR-0020, ADR-0022,
> ADR-0023, ADR-0039.

**Owns (schema).** `mnemosyne` — `episodes`, `semantic`, `procedures`,
`preferences`, `candidates`, `consolidation_runs`, `insights`; pgvector + HNSW
indexes; per-schema DB role `jarvis_mnemosyne`. Working / session / spatial
memory are **borrowed**: owned by the Ephemeral store, the Session Manager, and
the Scene service respectively — never re-owned here.

**Must not.** Be treated as authoritative truth. Duplicate ATLAS facts (it may
be *evidence* for a derived fact via an `evidence.ref` episode id). Serve recall
without a `top-k` + relevance-floor bound, or let cosine similarity dictate
relevance. Store an episode that has not passed the candidate gate. Be written
by anything except the Knowledge Ingestion mediator.

**Extraction seam.** → the knowledge service (with `@jarvis/world-model`).
