import { describe, it, expect } from 'vitest';
import { adaptiveMemorySelection, memoryTrace } from './memory-selection.ts';
import type { MemoryRecord } from './personal-memory.ts';

/**
 * The selection that reaches the model, tested as one unit.
 *
 * The live defect: the request path selected with a category hint and no intent limit, threshold or
 * diversity, while the diagnostic recomputed with all of them. The trace said six records; the
 * database recorded zero ids. Everything here therefore asserts on `adaptiveMemorySelection`, which is
 * the single function the CompanionService now calls for context, persistence and tracing.
 */
const record = (input: {
  id: string; category: MemoryRecord['category']; subject: string; statement: string;
  privacyClass?: 'PUBLIC' | 'INTERNAL' | 'SENSITIVE' | 'RESTRICTED';
}): MemoryRecord => ({
  id: input.id, principalId: 'owner', category: input.category, subject: input.subject,
  statement: input.statement, source: 'import', confidence: 0.9,
  privacyClass: input.privacyClass ?? 'INTERNAL', cloudEligible: true, reviewStatus: 'approved',
  createdAt: '2026-01-01T00:00:00Z',
} as unknown as MemoryRecord);

const profile: MemoryRecord[] = [
  record({ id: 'career-1', category: 'history', subject: 'esports organisation', statement: 'Founded and ran a competitive esports organisation.' }),
  record({ id: 'career-2', category: 'history', subject: 'restaurant career', statement: 'Worked as a chef in a busy restaurant kitchen.' }),
  record({ id: 'career-3', category: 'history', subject: 'streaming career', statement: 'Streamed competitive gaming for an audience.' }),
  record({ id: 'career-4', category: 'milestone', subject: 'first company', statement: 'Registered a first limited company at twenty.' }),
  record({ id: 'career-5', category: 'skill', subject: 'butchery', statement: 'Trained as a butcher before moving into technology.' }),
  record({ id: 'learn-1', category: 'learning', subject: 'learning style', statement: 'Learns best from worked examples and concrete analogies.' }),
  record({ id: 'comm-1', category: 'communication', subject: 'explanation style', statement: 'Prefers short sentences and no hedging.' }),
  record({ id: 'biz-1', category: 'business', subject: 'scale smiths', statement: 'Runs ScaleSmiths with a business partner.' }),
  record({ id: 'sensitive-1', category: 'history', subject: 'career gap', statement: 'A private career matter kept local only.', privacyClass: 'SENSITIVE' }),
  // Enough career evidence that the first broad pass fills its ceiling and a follow-up has somewhere
  // to expand to - the live conversation's actual shape, where 24 of 123 records were taken at once.
  ...Array.from({ length: 26 }, (_, index) => record({
    id: `career-extra-${index}`, category: 'history' as const,
    subject: `career chapter ${index}`, statement: `Career chapter ${index}: worked in a different trade before technology.`,
  })),
];

const select = (query: string, extra: { previousQuery?: string; alreadyGiven?: string[] } = {}) =>
  adaptiveMemorySelection({ records: profile, query, principalId: 'owner', locality: 'cloud', ...extra });

describe('career recall', () => {
  it('selects career records and returns the ids that will be persisted', () => {
    const result = select('Mate, tell me everything you know about my previous career.');
    expect(result.plan.intent).toBe('COMPREHENSIVE_RECALL');
    expect(result.selected.length).toBeGreaterThanOrEqual(4);
    expect(result.ids).toContain('career-1');
    expect(result.text).toContain('esports organisation');
    expect(result.bytes).toBeGreaterThan(0);
    // The block is what the model sees; the ids are what the database records. They must agree.
    for (const id of result.ids) {
      const chosen = result.selected.find(entry => entry.record.id === id)!;
      expect(result.text).toContain(chosen.record.subject);
    }
  });

  it('never includes a SENSITIVE record on a cloud turn', () => {
    const result = select('Mate, tell me everything you know about my previous career.');
    expect(result.ids).not.toContain('sensitive-1');
    expect(result.text).not.toContain('private career matter');
  });
});

describe('additive follow-up', () => {
  it('expands within the same topic instead of repeating the first answer', () => {
    const first = select('Mate, tell me everything you know about my previous career.');
    const followUp = select("What else haven't you mentioned?", {
      previousQuery: 'Mate, tell me everything you know about my previous career.',
      alreadyGiven: first.ids,
    });
    expect(followUp.plan.intent).toBe('FOLLOW_UP');
    // Additional career evidence, and nothing that was already handed over.
    expect(followUp.ids.some(id => !first.ids.includes(id))).toBe(true);
    for (const id of followUp.ids) expect(first.ids).not.toContain(id);
  });

  it('stays on the topic: the previous question supplies the words the follow-up lacks', () => {
    const first = select('Mate, tell me everything you know about my previous career.');
    const followUp = select("What else haven't you mentioned?", {
      previousQuery: 'Mate, tell me everything you know about my previous career.',
      alreadyGiven: first.ids,
    });
    expect(followUp.ids.every(id => !id.startsWith('biz-') && !id.startsWith('learn-'))).toBe(true);
  });

  it('reports honest exhaustion when every relevant record was already given', () => {
    const followUp = select("What else haven't you mentioned?", {
      previousQuery: 'Mate, tell me everything you know about my previous career.',
      alreadyGiven: profile
        .filter(entry => ['history', 'skill', 'milestone', 'decision'].includes(entry.category))
        .map(entry => entry.id),
    });
    expect(followUp.text).toBe('');
    expect(followUp.excluded.some(entry => entry.reason === 'already_provided')).toBe(true);
  });
});

describe('personalised explanation', () => {
  it('selects the learning preference rather than the whole profile', () => {
    const result = select('Explain that in a way that suits how I learn best.');
    expect(result.plan.intent).toBe('PERSONALISED_EXPLANATION');
    expect(result.ids).toContain('learn-1');
    expect(result.ids).not.toContain('career-1');
    expect(result.ids).not.toContain('biz-1');
    expect(result.text).toContain('worked examples');
  });

  it('stays empty for an impersonal science question', () => {
    const result = select("What's the difference between ionic and covalent bonds?");
    expect(result.plan.intent).toBe('GENERAL_KNOWLEDGE');
    expect(result.selected).toHaveLength(0);
    expect(result.text).toBe('');
  });
});

describe('broad self-profile', () => {
  const prompt = "Without me giving you any background, tell me who I am, what I've accomplished and what I'm working towards.";

  it('is a profile question, not a targeted fact', () => {
    const result = select(prompt);
    expect(result.plan.intent).toBe('PROFILE_OVERVIEW');
    expect(result.plan.limit).toBeGreaterThanOrEqual(16);
  });

  it('retrieves across the profile instead of marking everything irrelevant', () => {
    const result = select(prompt);
    expect(result.selected.length).toBeGreaterThanOrEqual(5);
    expect(new Set(result.selected.map(entry => entry.record.category)).size).toBeGreaterThanOrEqual(3);
    expect(result.excluded.filter(entry => entry.reason === 'irrelevant')).toHaveLength(0);
  });

  it('still excludes what the owner has not authorised for cloud', () => {
    const result = select(prompt);
    expect(result.ids).not.toContain('sensitive-1');
  });
});

describe('recall trace privacy', () => {
  const SENTINEL_QUERY = 'ZEBRA-SENTINEL-QUERY my private career story';
  const SENTINEL_STATEMENT = 'SENTINEL-STATEMENT-7731 a private fact';

  it('never carries the question, the topic or a memory statement', () => {
    const records = [record({ id: 'secret-1', category: 'history', subject: 'private subject', statement: SENTINEL_STATEMENT })];
    const selection = adaptiveMemorySelection({ records, query: SENTINEL_QUERY, principalId: 'owner', locality: 'cloud' });
    const line = JSON.stringify(memoryTrace({
      correlationId: 'corr', principalId: 'owner', locality: 'cloud', selection,
      candidates: records.length, approved: 1, queryChars: SENTINEL_QUERY.length, topicChars: 41,
    }));
    expect(line).not.toContain('ZEBRA-SENTINEL');
    expect(line).not.toContain('SENTINEL-STATEMENT');
    expect(line).not.toContain('private career story');
    expect(line).toContain('"queryChars"');
    expect(line).toContain('"selected"');
  });

  it('reports counts that match the selection that was actually used', () => {
    const selection = adaptiveMemorySelection({
      records: profile, query: 'Mate, tell me everything you know about my previous career.',
      principalId: 'owner', locality: 'cloud',
    });
    const trace = memoryTrace({ correlationId: 'c', principalId: 'owner', locality: 'cloud', selection, candidates: profile.length, approved: profile.length, queryChars: 60 });
    expect(trace.selected).toBe(selection.selected.length);
    expect(trace.blockBytes).toBe(selection.bytes);
    expect(trace.cloudIneligible).toBe(1); // the SENSITIVE record
  });
});
