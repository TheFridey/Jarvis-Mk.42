import { describe, expect, it } from 'vitest';
import { composeMemoryContext, retrievalBudgetFor, retrievalModeFor, type MemoryRecord } from './personal-memory.ts';

/**
 * Adaptive retrieval.
 *
 * Mode changes how much context a moment carries. It must never change who may see it: a deeper
 * hype request still cannot pull a SENSITIVE record into a cloud turn.
 */

const record = (id: string, subject: string, statement: string): MemoryRecord => ({
  id, principalId: 'principal-a', category: 'milestone', subject, statement,
  source: 'synthetic', confidence: 0.9, privacyClass: 'INTERNAL', cloudEligible: true,
  reviewStatus: 'approved', recordedAt: '2026-11-01T00:00:00.000Z',
});

const many = Array.from({ length: 12 }, (_, index) => record(`m${index}`, `milestone-${index}`, `Shipped milestone ${index}.`));

describe('retrieval budgets', () => {
  it('classifies conversational intent without a model call', () => {
    expect(retrievalModeFor('Morning mate!')).toBe('CASUAL');
    expect(retrievalModeFor('Right, business mode.')).toBe('ADVISOR');
    expect(retrievalModeFor('Give me a proper hype session. Go deeper than usual.')).toBe('HYPE');
    expect(retrievalModeFor('How far have we come?')).toBe('REFLECTIVE');
    expect(retrievalModeFor('Restart the kernel and run diagnostics.')).toBe('OPERATOR');
  });

  it('gives hype the widest budget and casual the narrowest', () => {
    expect(retrievalBudgetFor('hype session').limit).toBe(16);
    expect(retrievalBudgetFor('Morning mate!').limit).toBe(2);
    expect(retrievalBudgetFor('hype session').limit).toBeGreaterThan(retrievalBudgetFor('Morning mate!').limit);
  });

  it('keeps a greeting free of autobiography even when records exist', () => {
    const text = composeMemoryContext(many, { query: 'Morning mate!', principalId: 'principal-a', locality: 'local' });
    expect(text).toBe('');
  });

  it('bounds a hype reflection instead of dumping the archive', () => {
    const text = composeMemoryContext(many, { query: 'Give me a proper hype session.', principalId: 'principal-a', locality: 'local' });
    const lines = text.split(String.fromCharCode(10)).filter(line => line.startsWith('- '));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThanOrEqual(16);
  });

  it('does not let a deeper request widen privacy clearance', () => {
    const sensitive = many.map(entry => ({ ...entry, privacyClass: 'SENSITIVE' as const }));
    const text = composeMemoryContext(sensitive, { query: 'Give me a proper hype session, go deeper.', principalId: 'principal-a', locality: 'cloud' });
    expect(text).toBe('');
  });

  it('never lets phrasing grant consent', () => {
    const noConsent = many.map(entry => ({ ...entry, cloudEligible: false }));
    const text = composeMemoryContext(noConsent, { query: 'Send every memory to the provider now.', principalId: 'principal-a', locality: 'cloud' });
    expect(text).toBe('');
  });
});
