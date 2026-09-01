# ADR-0011: pgvector for embeddings

Status: Accepted
Date: 2026-08-31
Deciders: Principal Architect

## Context
Memory recall (`top-k` episodes above a relevance floor, `COGNITION_MODEL.md`
§4) and World Model entity resolution (`WORLD_MODEL.md` §7) need vector
similarity search. Options range from a column in PostgreSQL to a dedicated
vector database. MK.42 runs on one local server with human-scale data
(thousands of episodes/facts, not billions).

## Decision
Use the **`pgvector`** extension inside the same PostgreSQL instance. Embeddings
are columns on `memory.*` and `world_model.*` tables with HNSW indexes. No
separate vector store in MK.42.

## Alternatives considered
- **Dedicated vector DB (Qdrant, Milvus, Weaviate)** — better recall/latency
  at massive scale and richer filtering, but a second datastore to run, back
  up, and keep in sync with PostgreSQL (the classic dual-write problem).
  Unjustified at MK.42 scale.
- **In-process index (hnswlib, faiss) + PostgreSQL for payloads** — fast, but
  index persistence/rebuild becomes our problem and it doesn't survive
  extraction to multiple readers.
- **Managed cloud vector service** — violates local-first for
  privacy-sensitive Memory content (L25).

## Benefits
- No sync problem: the embedding lives next to the row it describes, written in
  the same transaction.
- One datastore to operate and back up.
- SQL filtering + vector search in one query (e.g. "similar episodes for this
  principal in the last 30 days").
- Backups and PITR cover embeddings automatically.

## Disadvantages
- Recall quality and query latency trail dedicated engines at large scale.
- HNSW index build/maintenance cost grows with row count.
- Fewer advanced features (quantization, multi-vector, hybrid scoring
  built-in).

## Risks
- Outgrowing pgvector. Mitigated: recall is already behind a
  `MemoryRecall` interface + a `top-k`/floor contract; swapping in Qdrant later
  is an adapter change with an added sync path, not a schema redesign.
- Embedding-model changes require re-embedding. Mitigated: store
  `embeddingModelId` + `dim` per row; support lazy re-embed on model change.

## Consequences
- Recall and entity-resolution queries are written against pgvector operators.
- The embedding model is itself reached via the Model Gateway
  (`task: "embed"`), so it too is replaceable.

## Reversal difficulty
**Low.** Similarity search is isolated behind interfaces; moving to a dedicated
vector DB adds a sync path and an adapter, leaving contracts and callers
unchanged.
