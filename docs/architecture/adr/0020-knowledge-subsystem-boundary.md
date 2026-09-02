# ADR-0020: Knowledge subsystem boundary — ATLAS and MNEMOSYNE

Status: Accepted
Date: 2026-09-01
Deciders: Principal Architect / Knowledge Architect

## Context
MK.46 introduces the temporal world model (**ATLAS**) and memory (**MNEMOSYNE**).
L8 already mandates they be separate systems; ADR-0017 already forbids duplicated
authority. The risk this ADR closes: the two collapsing into one generic vector
store, or "memory" becoming a second State Manager. The brief also adds capability
beyond the GENESIS sketch — a causal-hypothesis layer, eight memory classes, a
candidate pipeline, scheduled consolidation, a morning-insight mechanism,
multi-factor retrieval — each a chance to blur the boundary.

## Decision
- **Two peer protected subsystems.** `packages/world-model` (ATLAS, schema
  `atlas`) and `packages/memory` (MNEMOSYNE, schema `mnemosyne`): separate
  schemas, separate read service interfaces (`AtlasQuery`, `MemoryRecall`),
  separate single owners. The schema rename from the older `world_model` /
  `memory` sketch names is recorded here.
- **One Knowledge Ingestion mediator** is the *only* writer to `atlas.*` and
  `mnemosyne.*`. It has the same status as the Capability Executor: named and
  protected by `KERNEL_CONSTITUTION.md`, but **not a 17th entry in the frozen
  16**. It stamps provenance, applies untrusted tagging, sets `privacyClass`,
  resolves entities once, and routes each input to ATLAS, MNEMOSYNE, or both —
  as **separate records with cross-links**, never duplicated content.
- **Consolidation ("DREAMING")** is a Scheduler routine that emits *proposals*
  back through Knowledge Ingestion; it never writes either schema directly.
- **Retrieval is per-subsystem.** Only the Context Compiler fuses ATLAS facts
  and MNEMOSYNE episodes, inside its existing budgeted `ContextFrame`.
- **Per-schema DB roles** (`jarvis_atlas`, `jarvis_mnemosyne`), each granted on
  its own schema plus `SELECT` on `events.events` and nothing else. MK.43 still
  connects as one role; the service split binds to these.

## Alternatives considered
- **Fully independent ingestion pipelines, no mediator.** Rejected: duplicates
  entity resolution, provenance stamping, untrusted tagging, and privacy
  classification across two codebases; the split of a single proposal ("Rhys
  said X in this chat") across both systems becomes uncoordinated, making the
  no-duplicate-authority proof harder, not easier.
- **One "Knowledge" subsystem with ATLAS/MNEMOSYNE as internal modules.**
  Rejected: directly contradicts L8 ("distinct packages, distinct schemas,
  distinct service APIs") and the core mandate that the two not collapse.
- **A dedicated graph database (Neo4j) for ATLAS.** Rejected per ADR-0011's
  reasoning: no benchmarked evidence PostgreSQL cannot serve MK.42 volumes;
  relational + recursive queries suffice; a second datastore is unjustified cost.

## Benefits
- One validation / provenance choke point (L11, L14 enforced in exactly one
  place).
- The "conversation happened -> derived fact + episode" split is coordinated in
  a single component.
- Extraction seam #1 (`SYSTEM_BOUNDARIES.md` §10) preserved: both lift out
  together as the knowledge service.
- No expansion of the frozen 16.

## Disadvantages
- Knowledge Ingestion is a new named internal service to justify and protect
  (this ADR is that justification).
- Every knowledge write goes through one component — a throughput chokepoint at
  large scale. Accepted: MK.42 volume is human-scale; the seam to extract it
  exists.

## Risks
- **Someone bypasses the mediator and writes `atlas.*` / `mnemosyne.*` from a
  projector or an agent.** Mitigated: per-schema roles; the boundary integration
  test asserts `jarvis_atlas` has no `mnemosyne` privilege and vice versa;
  `DATA_OWNERSHIP.md` §1 names Knowledge Ingestion as the sole writer.
- **MNEMOSYNE drifts into holding system state.** Mitigated: working/session/
  spatial memory are explicitly pointers to their existing Kernel owners
  (Ephemeral store, Session Manager, Scene service), not MNEMOSYNE tables.
- **ATLAS facts duplicate Projected State.** Mitigated: `objective`/`node`/
  `device` entities are reference shells; the authoritative record stays in
  `projections.*`; ATLAS has no write path there.

## Consequences
- `packages/contracts` gains `causal.ts`, `memory.ts`, `memory-candidate.ts`,
  `memory-insight.ts`, `knowledge-ingestion.ts`, `atlas-query.ts`,
  `memory-recall.ts`; `entity.ts` / `fact.ts` / `observation.ts` extended —
  these add required fields to `Entity` / `Fact` / `EntityRelationship`,
  source-breaking for producers, of which there are none at MK.46;
  `event-names.ts` gains `jarvis.world.*` and `jarvis.memory.*` (including the
  tombstone events `jarvis.world.record.forgotten` and
  `jarvis.memory.record.forgotten`).
- Migrations `0005_atlas.sql`, `0006_mnemosyne.sql`.
- `DATA_OWNERSHIP.md` §1 gains a row per new category, all owned by the ATLAS
  service or the MNEMOSYNE service, all written by Knowledge Ingestion.
- New model docs `ATLAS_MODEL.md`, `MNEMOSYNE_MODEL.md`; `WORLD_MODEL.md` and
  `STATE_MODEL.md` §Memory become pointers.
- `KERNEL_CONSTITUTION.md` gains one sentence naming Knowledge Ingestion as an
  Executor-class protected internal service.

## Boundary proof
1. **World Model ≠ State Manager.** `atlas.facts` (beliefs, provenance,
   temporal validity) vs `projections.*` (system state). Different schemas,
   owners, question. No write path from ATLAS to `projections.*`.
2. **Memory ≠ World Model.** Episodes (narrative, lossy, decaying) vs facts
   (structured, provenance-bound, revised not deleted). Only coupling: an ATLAS
   fact may cite a MNEMOSYNE episode id as evidence. Content never copied.
3. **Memory ≠ event log.** The Event Log is authoritative ordered append-only
   history. Episodes are curated compressible interpretations with their own
   retention. Losing MNEMOSYNE loses recall, not history. `MEMORY_CANDIDATE`
   retention class already models the promotion step.
4. **Vector store ≠ source of truth.** pgvector columns are similarity indexes
   (ADR-0011). Recall ranking uses similarity as one bounded factor of seven;
   contradiction resolution never consults embeddings.
5. **No duplicate authority.** Every new category has exactly one owner, one
   writer (Knowledge Ingestion), one schema — recorded in `DATA_OWNERSHIP.md` §1.

## Reversal difficulty
**Moderate.** The two schemas, the seven contract files, and the mediator port
are additive. Backing the change out means deleting the `atlas`/`mnemosyne`
schemas and the `packages/world-model` + `packages/memory` implementations;
nothing in the frozen 16 changed, so the spine is untouched.
