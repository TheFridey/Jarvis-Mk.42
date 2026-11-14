import { describe, it, expect } from 'vitest';
import { retrievalIntentFor, outputAllowanceFor } from './retrieval-intent.ts';
import { selectMemories, type MemoryRecord } from './personal-memory.ts';

/**
 * Three live defects, one file: the intent classifier was too coarse in three specific ways, and the
 * output allowance was a single number for every kind of question.
 */
describe('named entity precedence', () => {
  it('reads "tell me everything about <thing>" as depth about that thing', () => {
    const plan = retrievalIntentFor('Tell me everything you know about Stigma eSports.');
    expect(plan.intent).toBe('ENTITY_DETAIL');
    expect(plan.limit).toBeLessThanOrEqual(12);
  });

  it('still treats "tell me everything about me" as a profile question', () => {
    expect(retrievalIntentFor('Tell me everything you know about me.').intent).toBe('COMPREHENSIVE_RECALL');
    expect(retrievalIntentFor('Tell me everything you know about my previous career.').intent).toBe('COMPREHENSIVE_RECALL');
  });
});

describe('personalised explanation', () => {
  it('is not treated as impersonal general knowledge', () => {
    expect(retrievalIntentFor('Explain that in a way that suits how I learn best.').intent).toBe('PERSONALISED_EXPLANATION');
    expect(retrievalIntentFor('Can you explain it the way I understand best?').intent).toBe('PERSONALISED_EXPLANATION');
  });

  it('keeps a plain science question impersonal', () => {
    const plan = retrievalIntentFor("What's the difference between ionic and covalent bonds?");
    expect(plan.intent).toBe('GENERAL_KNOWLEDGE');
    expect(plan.limit).toBe(0);
  });

  it('retrieves only preference-shaped categories', () => {
    const plan = retrievalIntentFor('Explain that in a way that suits how I learn best.');
    expect(plan.categories).toEqual(['learning', 'communication', 'preference']);
  });
});

describe('output allowance', () => {
  it('gives a greeting far less room than a deep session', () => {
    expect(outputAllowanceFor('SOCIAL')).toBeLessThan(outputAllowanceFor('ENCOURAGEMENT'));
    expect(outputAllowanceFor('SOCIAL')).toBeLessThanOrEqual(512);
    expect(outputAllowanceFor('ENCOURAGEMENT')).toBeGreaterThanOrEqual(4096);
  });

  it('stays inside the hard ceiling for every intent', () => {
    const intents = ['SOCIAL', 'BANTER', 'TARGETED_FACT', 'ENTITY_DETAIL', 'CAREER_HISTORY', 'PROJECT_INVENTORY',
      'RECENT_PROGRESS', 'PROFILE_OVERVIEW', 'REFLECTIVE', 'ENCOURAGEMENT', 'TECHNICAL_OPERATION',
      'GENERAL_KNOWLEDGE', 'COMPREHENSIVE_RECALL', 'FOLLOW_UP', 'PERSONALISED_EXPLANATION'] as const;
    for (const intent of intents) {
      const allowance = outputAllowanceFor(intent);
      expect(allowance).toBeGreaterThan(0);
      expect(allowance).toBeLessThanOrEqual(8192);
    }
  });
});

describe('additive follow-up', () => {
  const record = (id: string, subject: string, statement: string, category: 'history' | 'project' = 'history'): MemoryRecord => ({
    id, principalId: 'owner', category, subject, statement, source: 'import', confidence: 0.9,
    privacyClass: 'INTERNAL', cloudEligible: true, reviewStatus: 'approved', createdAt: '2026-01-01T00:00:00Z',
  } as unknown as MemoryRecord);
  const records = [
    record('m1', 'esports organisation', 'Ran an esports organisation.'),
    record('m2', 'restaurant career', 'Ran a kitchen.'),
    record('m3', 'streaming career', 'Streamed competitively.'),
  ];

  it('does not repeat facts the conversation has already received', () => {
    const first = selectMemories({ records, query: 'tell me everything about my previous career', principalId: 'owner', locality: 'cloud' });
    const ids = first.selected.map(entry => entry.record.id);
    expect(ids.length).toBeGreaterThan(0);
    const second = selectMemories({ records, query: 'what else about my esports organisation and restaurant career', principalId: 'owner', locality: 'cloud', exclude: ids });
    const secondIds = second.selected.map(entry => entry.record.id);
    expect(secondIds.some(id => ids.includes(id))).toBe(false);

    // A record that would otherwise score, but was already handed over, is excluded for that reason.
    const repeat = selectMemories({ records, query: 'esports organisation', principalId: 'owner', locality: 'cloud', exclude: ['m1'] });
    expect(repeat.selected.map(entry => entry.record.id)).not.toContain('m1');
    expect(repeat.excluded.some(entry => entry.id === 'm1' && entry.reason === 'already_provided')).toBe(true);
  });

  it('says nothing rather than inventing relevance when everything relevant is exhausted', () => {
    const all = ['m1', 'm2', 'm3'];
    const second = selectMemories({ records, query: 'what else', principalId: 'owner', locality: 'cloud', exclude: all });
    expect(second.selected).toHaveLength(0);
  });
});
