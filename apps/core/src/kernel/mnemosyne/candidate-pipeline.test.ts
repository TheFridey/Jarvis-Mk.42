import { describe, expect, it } from 'vitest';
import { decideDisposition, scoreCandidate, type ScoreContext } from './candidate-pipeline.ts';

const ctx = (over: Partial<ScoreContext>): ScoreContext => ({
  maxSimilarityToStored: 0.1,
  touchesActiveObjective: false,
  confidenceHint: 0.7,
  privacyClass: 'INTERNAL',
  sourceKind: 'event',
  looksDurable: false,
  ...over,
});

describe('scoreCandidate', () => {
  it('stores the full component breakdown', () => {
    const s = scoreCandidate(ctx({}));
    for (const k of ['novelty', 'importance', 'futureUtility', 'objectiveRelevance', 'confidence', 'duplication', 'sensitivity', 'durability', 'sourceQuality', 'composite'] as const) {
      expect(s[k]).toBeGreaterThanOrEqual(0);
      expect(s[k]).toBeLessThanOrEqual(1);
    }
  });

  it('scores an objective-relevant durable decision above a stray event', () => {
    const strong = scoreCandidate(ctx({ touchesActiveObjective: true, looksDurable: true, sourceKind: 'decision' }));
    const weak = scoreCandidate(ctx({}));
    expect(strong.composite).toBeGreaterThan(weak.composite);
  });

  it('penalises a near-duplicate', () => {
    const dup = scoreCandidate(ctx({ maxSimilarityToStored: 0.95 }));
    const uniq = scoreCandidate(ctx({ maxSimilarityToStored: 0.05 }));
    expect(dup.duplication).toBeGreaterThan(0.9);
    expect(dup.composite).toBeLessThan(uniq.composite);
  });

  it('marks sensitive material as sensitive', () => {
    expect(scoreCandidate(ctx({ privacyClass: 'RESTRICTED' })).sensitivity).toBe(1);
    expect(scoreCandidate(ctx({ privacyClass: 'PUBLIC' })).sensitivity).toBe(0);
  });
});

describe('decideDisposition', () => {
  it('merges a duplicate rather than accepting it', () => {
    expect(decideDisposition(scoreCandidate(ctx({ maxSimilarityToStored: 0.95 })))).toBe('merged');
  });

  it('defers sensitive material that is not overwhelmingly important', () => {
    expect(decideDisposition(scoreCandidate(ctx({ privacyClass: 'SENSITIVE', confidenceHint: 0.5 })))).toBe('deferred');
  });

  it('accepts a high-value candidate', () => {
    const s = scoreCandidate(ctx({ touchesActiveObjective: true, looksDurable: true, sourceKind: 'decision', confidenceHint: 0.9 }));
    expect(decideDisposition(s)).toBe('accepted');
  });

  it('rejects a low-value candidate', () => {
    const s = scoreCandidate(ctx({ sourceKind: 'event', confidenceHint: 0.2, maxSimilarityToStored: 0.4 }));
    expect(['rejected', 'deferred']).toContain(decideDisposition(s));
  });
});
