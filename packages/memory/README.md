# @jarvis/memory

**Purpose.** Memory — the experiential record (`docs/architecture/
STATE_MODEL.md` §Memory, `MK42_ARCHITECTURE.md` §14). Episodes (conversations,
action outcomes, notable event sequences), rolling summaries, and embeddings;
`top-k` recall with a relevance floor (never "all relevant memories" — review
§16.12); summarisation + decay compaction.

**Owns.** The `memory` schema + pgvector indexes; object-storage references for
large artefacts.

**Depends on.** `@jarvis/contracts`, a PostgreSQL client (+ pgvector),
`@jarvis/models` types (embeddings are requested via the Model Gateway,
`task: "embed"`), a `BlobStore` interface.

**Must not.** Be treated as authoritative truth. Duplicate World Model facts
(it may be *evidence* for a derived fact). Serve recall without a `top-k` +
floor bound.

**Extraction seam.** → the knowledge service (with `@jarvis/world-model`).
