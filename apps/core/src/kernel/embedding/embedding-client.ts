/**
 * DeterministicEmbeddingClient — a model-free, offline, reproducible embedding
 * (ADR-0011, ADR-0023, and the MK.46 knowledge plan).
 *
 * WHY not a real model here: ATLAS entity resolution and MNEMOSYNE recall need a
 * similarity signal that is (a) available with no external dependency, (b) byte-
 * for-byte reproducible so tests and belief revision are deterministic. Cosine
 * distance is only ever ONE bounded factor in recall (ADR-0023) and a threshold
 * gate in entity resolution — never a truth oracle — so a hashed lexical
 * embedding is sufficient for the phase. A model-backed adapter is a drop-in
 * replacement behind `EmbeddingClient`; stored vectors carry `modelId` so a
 * swap is detectable and a re-embed pass can run.
 *
 * Method: lowercased text -> word unigrams + word bigrams + character 3-grams,
 * each feature hashed (FNV-1a) into `dimensions` buckets with a sign hash, TF
 * accumulated, then L2-normalised. Shared vocabulary => high cosine; disjoint
 * vocabulary => near-zero. Purely additive and stable for the life of `modelId`.
 */
import type { EmbeddingClient, EmbeddedText, EmbeddingVector } from '@jarvis/contracts';

const MODEL_ID = 'deterministic-hash-v1';
const DIMENSIONS = 1536;

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    // 32-bit FNV prime multiply, kept in uint32 range.
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function features(text: string): string[] {
  const norm = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (norm === '') return [];
  const words = norm.split(' ');
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    out.push(`w:${words[i]}`);
    if (i + 1 < words.length) out.push(`b:${words[i]} ${words[i + 1]}`);
  }
  const compact = norm.replace(/ /g, '_');
  for (let i = 0; i + 3 <= compact.length; i++) out.push(`c:${compact.slice(i, i + 3)}`);
  return out;
}

export class DeterministicEmbeddingClient implements EmbeddingClient {
  readonly modelId = MODEL_ID;
  readonly dimensions = DIMENSIONS;

  async embed(text: string): Promise<EmbeddedText> {
    return { vector: this.vectorFor(text), modelId: this.modelId };
  }

  async embedMany(texts: string[]): Promise<EmbeddedText[]> {
    return texts.map((t) => ({ vector: this.vectorFor(t), modelId: this.modelId }));
  }

  private vectorFor(text: string): EmbeddingVector {
    const v = new Array<number>(this.dimensions).fill(0);
    for (const f of features(text)) {
      const h = fnv1a(f);
      const bucket = h % this.dimensions;
      const sign = (fnv1a(`sign:${f}`) & 1) === 0 ? 1 : -1;
      v[bucket]! += sign;
    }
    let norm = 0;
    for (const x of v) norm += x * x;
    norm = Math.sqrt(norm);
    if (norm === 0) return v;
    for (let i = 0; i < v.length; i++) v[i]! /= norm;
    return v;
  }
}

/** Postgres `vector` literal: `[0.1,0.2,...]`. postgres.js has no native binding
 *  for the pgvector type, so callers pass this string for `::vector` columns. */
export function toPgVector(vec: EmbeddingVector): string {
  return `[${vec.map((x) => (Number.isFinite(x) ? x : 0)).join(',')}]`;
}
