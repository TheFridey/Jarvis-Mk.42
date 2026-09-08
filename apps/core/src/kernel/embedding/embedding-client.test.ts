import { describe, expect, it } from 'vitest';
import { cosineSimilarity } from '@jarvis/contracts';
import { DeterministicEmbeddingClient, toPgVector } from './embedding-client.ts';

describe('DeterministicEmbeddingClient', () => {
  const client = new DeterministicEmbeddingClient();

  it('is deterministic for the same input', async () => {
    const a = await client.embed('ScaleSmiths is Rhys\'s consultancy business');
    const b = await client.embed('ScaleSmiths is Rhys\'s consultancy business');
    expect(a.vector).toEqual(b.vector);
    expect(a.modelId).toBe('deterministic-hash-v1');
  });

  it('produces a unit vector of the declared dimensionality', async () => {
    const { vector } = await client.embed('the office server hosts postgres');
    expect(vector).toHaveLength(client.dimensions);
    const norm = Math.sqrt(vector.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('scores near-duplicate text higher than unrelated text', async () => {
    const base = (await client.embed('deploy the ScaleSmiths web app to production')).vector;
    const near = (await client.embed('deploy ScaleSmiths web app to the production server')).vector;
    const far = (await client.embed('the cat sat quietly on a warm windowsill')).vector;
    expect(cosineSimilarity(base, near)).toBeGreaterThan(cosineSimilarity(base, far));
    expect(cosineSimilarity(base, near)).toBeGreaterThan(0.4);
  });

  it('handles empty / punctuation-only text without throwing', async () => {
    const { vector } = await client.embed('   !!!   ');
    expect(vector).toHaveLength(client.dimensions);
    expect(vector.every((x) => x === 0)).toBe(true);
  });

  it('embedMany preserves order', async () => {
    const [a, b] = await client.embedMany(['alpha token', 'beta token']);
    expect(a!.vector).toEqual((await client.embed('alpha token')).vector);
    expect(b!.vector).toEqual((await client.embed('beta token')).vector);
  });

  it('toPgVector renders a pgvector literal', () => {
    expect(toPgVector([0.5, -0.25, 0])).toBe('[0.5,-0.25,0]');
  });
});
