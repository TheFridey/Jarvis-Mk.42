import { describe, expect, it } from 'vitest';
import { recallDiagnostics, selectMemories, type MemoryRecord } from './personal-memory.ts';

/**
 * The defect this exists to prevent: 123 approved records, a working repository, and a live
 * conversation that correctly said it had nothing — because the principal did not match. From the
 * outside that is indistinguishable from an empty table, so the counts must distinguish it.
 */

const record = (id: string, principalId: string, over: Partial<MemoryRecord> = {}): MemoryRecord => ({
  id, principalId, category: 'milestone', subject: `subject-${id}`, statement: `statement-${id}`,
  source: 'synthetic', confidence: 0.9, privacyClass: 'INTERNAL', cloudEligible: true,
  reviewStatus: 'approved', recordedAt: '2026-11-01T00:00:00.000Z', ...over,
});

describe('recall diagnostics', () => {
  it('shows a principal mismatch instead of an empty table', () => {
    const records = [record('a', 'local-owner'), record('b', 'local-owner')];
    const diag = recallDiagnostics({ records, query: 'What do you actually know about me?', principalId: 'principal-operator', locality: 'cloud' });
    expect(diag.candidates).toBe(2);
    expect(diag.wrongPrincipal).toBe(2);
    expect(diag.selected).toBe(0);
  });

  it('separates irrelevance from ineligibility', () => {
    const records = [record('c', 'owner'), record('d', 'owner', { privacyClass: 'SENSITIVE' })];
    const diag = recallDiagnostics({ records, query: 'something entirely unrelated about weather', principalId: 'owner', locality: 'cloud' });
    expect(diag.irrelevant).toBe(1);
    expect(diag.selected).toBe(0);
    expect(diag.cloudEligible).toBe(1);
  });

  it('reports a successful inclusion with a byte count but no content', () => {
    const records = [record('e', 'owner')];
    const diag = recallDiagnostics({ records, query: 'How far have we come recently?', principalId: 'owner', locality: 'cloud' });
    expect(diag.selected).toBe(1);
    expect(diag.blockBytes).toBeGreaterThan(0);
    expect(Object.keys(diag)).not.toContain('statement');
  });

  it('retrieves milestones for a reflection without the owner naming a project', () => {
    const records = [record('f', 'owner', { statement: 'Shipped the paid client deployment.' })];
    const { selected } = selectMemories({ records, query: 'How far have we come recently?', principalId: 'owner', locality: 'cloud', categories: ['milestone', 'decision', 'project', 'business', 'history', 'ambition', 'skill', 'constraint'] });
    expect(selected).toHaveLength(1);
  });

  it('answers a profile question with a bounded summary, not the archive', () => {
    const records = Array.from({ length: 30 }, (_, index) => record(`p${index}`, 'owner'));
    const diag = recallDiagnostics({ records, query: 'What do you actually know about me?', principalId: 'owner', locality: 'cloud' });
    expect(diag.selected).toBeGreaterThan(0);
    expect(diag.selected).toBeLessThanOrEqual(20);
  });
});
