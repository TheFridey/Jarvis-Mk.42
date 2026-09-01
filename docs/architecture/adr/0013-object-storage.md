# ADR-0013: S3-compatible object storage (MinIO)

Status: Accepted
Date: 2026-08-31
Deciders: Principal Architect

## Context
JARVIS produces and consumes blobs: screenshots, audio/video clips captured by
an explicit capability, model artefacts, agent work-products, exports, and
Memory's cold-storage episode bodies (`STATE_MODEL.md` §6). These do not belong
in PostgreSQL (bloat, backup cost) and referencing scattered filesystem paths
couples components to a host layout. The adversarial review (§16.3) questioned
whether a single local server needs object storage at all.

## Decision
Run **MinIO** (S3-compatible) as one container in Compose. All blob access goes
through a `BlobStore` interface with an S3 implementation. Components store
**references** (bucket + key + content hash + metadata); bytes live in MinIO.
Buckets per concern (`captures`, `artifacts`, `exports`, `memory-cold`).

## Alternatives considered
- **Local filesystem + a `BlobStore` filesystem adapter** — zero extra infra;
  kept as the documented fallback implementation of the same interface. Loses
  clean multi-node access, lifecycle policies, and a no-migration path to
  cloud/replicated storage.
- **Blobs in PostgreSQL (bytea / large objects)** — simplest consistency
  story, but bloats the authoritative DB and its backups; rejected.
- **Cloud object storage (S3/R2/GCS) directly** — violates local-first for
  privacy-sensitive captures (L25, L27) and needs connectivity.

## Benefits
- One container; removes a future migration when a second node or replication
  is needed.
- Lifecycle rules (expire `captures` after N days) match retention policy.
- Same S3 API locally and (later) in cloud — the `BlobStore` interface never
  changes.
- Keeps PostgreSQL and its backups lean.

## Disadvantages
- One more service to run and secure (scoped access keys, bucket policies).
- Slight operational overhead vs a directory.

## Risks
- Over-engineering for MK.42. Mitigated: the cost is genuinely one container,
  and the filesystem adapter is a one-file fallback if we decide to drop it.
- Blob/DB reference drift (a row points at a missing object). Mitigated:
  content-hash in the reference; a periodic reconciliation job; blobs are
  written before the referencing row commits.

## Consequences
- No component reads/writes blob bytes except through `BlobStore`.
- Object storage is backed up (replicated bucket / periodic sync);
  `STATE_MODEL.md` §8.
- Capturing durable media is a capability with its own policy and retention.

## Reversal difficulty
**Low.** Switch the `BlobStore` implementation to the filesystem adapter (or a
cloud bucket) and run a one-time copy. No contract or caller changes.
