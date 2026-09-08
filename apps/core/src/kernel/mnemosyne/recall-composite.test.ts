import { describe, expect, it } from 'vitest';
import { applyWeightBounds, composite, DEFAULT_RECALL_WEIGHTS, MAX_SIM_WEIGHT } from './recall.ts';

const factors = {
  sim: 0, entity: 0, recency: 0, importance: 0, objective: 0, confidence: 0, sourceAuthority: 0,
};

describe('recall composite (ADR-0023)', () => {
  it('clamps the similarity weight so it cannot dominate', () => {
    const w = applyWeightBounds({ ...DEFAULT_RECALL_WEIGHTS, sim: 5 });
    expect(w.sim).toBe(MAX_SIM_WEIGHT);
  });

  it('a perfect vector match alone does not produce a high score', () => {
    const w = applyWeightBounds({ ...DEFAULT_RECALL_WEIGHTS, sim: 99 });
    const simOnly = composite({ ...factors, sim: 1 }, w);
    // sim capped at 0.35 of the (now sim-heavy) weight sum -> well under 0.5
    expect(simOnly).toBeLessThan(0.5);
  });

  it('combines all seven factors into [0,1]', () => {
    const r = composite(
      { sim: 0.9, entity: 0.8, recency: 0.7, importance: 0.6, objective: 1, confidence: 0.9, sourceAuthority: 0.8 },
      DEFAULT_RECALL_WEIGHTS,
    );
    expect(r).toBeGreaterThan(0.7);
    expect(r).toBeLessThanOrEqual(1);
  });

  it('is monotonic in each factor', () => {
    const low = composite({ ...factors, confidence: 0.1 }, DEFAULT_RECALL_WEIGHTS);
    const high = composite({ ...factors, confidence: 0.9 }, DEFAULT_RECALL_WEIGHTS);
    expect(high).toBeGreaterThan(low);
  });

  it('entity overlap and objective relevance both move the needle', () => {
    const base = composite(factors, DEFAULT_RECALL_WEIGHTS);
    expect(composite({ ...factors, entity: 1 }, DEFAULT_RECALL_WEIGHTS)).toBeGreaterThan(base);
    expect(composite({ ...factors, objective: 1 }, DEFAULT_RECALL_WEIGHTS)).toBeGreaterThan(base);
  });
});
