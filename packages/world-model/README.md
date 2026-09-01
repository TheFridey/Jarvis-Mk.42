# @jarvis/world-model

**Purpose.** The World Model (`docs/architecture/WORLD_MODEL.md`): entities,
relationships, and `Fact`s with mandatory provenance / confidence / epistemic
status and optional temporal validity; the evidence graph; belief revision
(supersede via temporal validity, **record** conflicts, never silent
overwrite); the ingestion pipeline (entity resolution → dedupe/supersession/
conflict → write + emit); temporal query API (`currentlyBelieved`,
`believedAt`, `history`) that returns "I don't know" as a real result.

**Owns.** The `world_model` schema (`entities`, `entity_relationships`,
`facts`, `facts_archive`, `evidence`, `conflicts`, `observations` index).

**Depends on.** `@jarvis/contracts`, a PostgreSQL client (+ pgvector for entity
resolution).

**Must not.** Store conversation transcripts or episodic narrative (that is
`@jarvis/memory`). Accept a fact without provenance/confidence. Be written by
anything except Kernel ingestion. Grow without bound (archival job required).

**Extraction seam.** → the knowledge service (with `@jarvis/memory`).
