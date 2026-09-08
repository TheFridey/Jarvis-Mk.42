/**
 * Embedding port — the similarity-vector producer for ATLAS entity resolution
 * and MNEMOSYNE recall (ADR-0011, ADR-0023).
 *
 * A vector is a SIMILARITY INDEX, never a source of truth. ATLAS contradiction
 * resolution and MNEMOSYNE trust ranking never consult it directly; recall uses
 * cosine distance as ONE bounded factor of seven (ADR-0023).
 *
 * MK.46 ships a deterministic, offline, model-free implementation
 * (`DeterministicEmbeddingClient` in apps/core). A real model-backed adapter is
 * a drop-in replacement behind this interface (ADR-0011 §Reversal): swapping it
 * is an adapter + a re-embed sync path, not a schema change. Every stored vector
 * records the `modelId` that produced it so a change can be detected.
 */

/** A dense vector. Length is fixed per deployment (`atlas`/`mnemosyne` columns
 *  are `vector(1536)`); the client declares its own `dimensions`. */
export type EmbeddingVector = number[];

export interface EmbeddedText {
  vector: EmbeddingVector;
  /** Stable id of the producer, stored alongside the vector for drift detection. */
  modelId: string;
}

export interface EmbeddingClient {
  /** Stable id of this embedding producer, e.g. `deterministic-hash-v1`. */
  readonly modelId: string;
  /** Output dimensionality; must match the target pgvector column width. */
  readonly dimensions: number;

  /** Embed one string. Deterministic implementations MUST return the same
   *  vector for the same input for the life of a `modelId`. */
  embed(text: string): Promise<EmbeddedText>;

  /** Batch form; order-preserving. */
  embedMany(texts: string[]): Promise<EmbeddedText[]>;
}

/** Cosine similarity in [-1, 1]; 1 = identical direction. Pure helper so both
 *  subsystems and their tests agree on the metric. */
export function cosineSimilarity(a: EmbeddingVector, b: EmbeddingVector): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
