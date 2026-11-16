import { describe, expect, it } from 'vitest';
import {
  MEMORY_CLOUD_CEILING, MEMORY_CONTEXT_LIMIT, MEMORY_POLICY_VERSION, classPermitsCloud,
  memoryContextLines, memoryRelevance, selectMemories, tokens, type MemoryRecord,
} from './personal-memory.ts';

/**
 * Memory governance, exercised on synthetic records.
 *
 * The cases that matter are the refusals: a private record must not reach a cloud request, a
 * revoked record must not be retrieved, another principal's memory must not be visible, and a
 * greeting must not drag a profile into the prompt.
 */

const base: MemoryRecord = {
  id: 'm1', principalId: 'principal-a', category: 'business', subject: 'ScaleSmiths client pipeline',
  statement: 'Two distributor conversations are live; no contracts signed yet.',
  source: 'owner-stated', confidence: 0.9, privacyClass: 'INTERNAL', cloudEligible: true,
  reviewStatus: 'approved', recordedAt: '2026-11-01T10:00:00.000Z',
};
const record = (over: Partial<MemoryRecord>): MemoryRecord => ({ ...base, ...over });

describe('memory selection', () => {
  it('is versioned and inherits the conversation ceiling', () => {
    expect(MEMORY_POLICY_VERSION).toBe(1);
    expect(MEMORY_CLOUD_CEILING).toBe('INTERNAL');
  });

  it('selects a relevant approved record and reports its score', () => {
    const { selected, excluded } = selectMemories({ records: [base], query: 'How is the ScaleSmiths pipeline looking?', principalId: 'principal-a', locality: 'cloud' });
    expect(selected).toHaveLength(1);
    expect(selected[0]!.score).toBeGreaterThan(0.5);
    expect(excluded).toEqual([]);
  });

  it('does not drag a profile into a greeting', () => {
    const { selected, excluded } = selectMemories({ records: [base], query: 'Evening Jarvis.', principalId: 'principal-a', locality: 'cloud' });
    expect(selected).toEqual([]);
    expect(excluded).toEqual([{ id: 'm1', reason: 'irrelevant' }]);
  });

  it('never lets a private record enter a cloud request', () => {
    const private_ = record({ id: 'm2', privacyClass: 'SENSITIVE', cloudEligible: true, subject: 'ScaleSmiths pipeline risk' });
    const { selected, excluded } = selectMemories({ records: [private_], query: 'What is the pipeline risk?', principalId: 'principal-a', locality: 'cloud' });
    expect(selected).toEqual([]);
    expect(excluded[0]!.reason).toBe('cloud_ineligible');
  });

  it('allows the same record locally', () => {
    const private_ = record({ id: 'm2', privacyClass: 'SENSITIVE', cloudEligible: false, subject: 'ScaleSmiths pipeline risk' });
    const { selected } = selectMemories({ records: [private_], query: 'What is the pipeline risk?', principalId: 'principal-a', locality: 'local' });
    expect(selected).toHaveLength(1);
  });

  it('treats RESTRICTED as un-sendable even when flagged eligible', () => {
    expect(classPermitsCloud(record({ privacyClass: 'RESTRICTED', cloudEligible: true }))).toBe(false);
    const { excluded } = selectMemories({ records: [record({ privacyClass: 'RESTRICTED', cloudEligible: true })], query: 'pipeline', principalId: 'principal-a', locality: 'cloud' });
    expect(excluded[0]!.reason).toBe('cloud_ineligible');
  });

  it('excludes revoked, superseded, rejected and unapproved records', () => {
    const records = [
      record({ id: 'r', revokedAt: '2026-11-10T00:00:00.000Z' }),
      record({ id: 's', supersededBy: 'newer' }),
      record({ id: 'j', reviewStatus: 'rejected' }),
      record({ id: 'p', reviewStatus: 'pending' }),
    ];
    const { selected, excluded } = selectMemories({ records, query: 'ScaleSmiths pipeline', principalId: 'principal-a', locality: 'local' });
    expect(selected).toEqual([]);
    expect(excluded.map(entry => entry.reason).sort()).toEqual(['not_approved', 'rejected', 'revoked', 'superseded']);
  });

  it('never crosses principals, even with a perfect match', () => {
    const other = record({ id: 'other', principalId: 'principal-b' });
    const { selected, excluded } = selectMemories({ records: [other], query: 'ScaleSmiths pipeline', principalId: 'principal-a', locality: 'local' });
    expect(selected).toEqual([]);
    expect(excluded).toEqual([{ id: 'other', reason: 'wrong_principal' }]);
  });

  it('caps the number of records and says which were dropped', () => {
    const many = Array.from({ length: MEMORY_CONTEXT_LIMIT + 2 }, (_, index) =>
      record({ id: `m${index}`, subject: 'Shopify app pricing', statement: 'Price band under review.' }));
    const { selected, excluded } = selectMemories({ records: many, query: 'Shopify app pricing', principalId: 'principal-a', locality: 'local' });
    expect(selected).toHaveLength(MEMORY_CONTEXT_LIMIT);
    expect(excluded.filter(entry => entry.reason === 'budget')).toHaveLength(2);
  });

  it('prefers a confident record when scores tie', () => {
    const strong = record({ id: 'strong', confidence: 0.95, subject: 'Aurora codename', statement: 'The codename is Aurora.' });
    const weak = record({ id: 'weak', confidence: 0.4, subject: 'Aurora codename', statement: 'The codename is Aurora.' });
    const { selected } = selectMemories({ records: [weak, strong], query: 'What was the Aurora codename?', principalId: 'principal-a', locality: 'local' });
    expect(selected[0]!.record.id).toBe('strong');
  });

  it('does not let a long record out-score a precise one', () => {
    const precise = record({ id: 'p', subject: 'pipeline', statement: 'Two live conversations.' });
    const verbose = record({ id: 'v', subject: 'notes', statement: 'pipeline '.repeat(40) });
    const { selected } = selectMemories({ records: [verbose, precise], query: 'pipeline', principalId: 'principal-a', locality: 'local' });
    expect(selected[0]!.record.id).toBe('p');
  });
});

describe('memory text', () => {
  it('gives the model subject and statement only — no ids or provenance', () => {
    const lines = memoryContextLines([{ record: base, score: 1 }]);
    expect(lines[0]).toBe('- ScaleSmiths client pipeline: Two distributor conversations are live; no contracts signed yet.');
  });

  it('strips punctuation and stop words from the query', () => {
    expect(tokens('So, what about the ScaleSmiths pipeline?')).toEqual(['scalesmiths', 'pipeline']);
  });

  it('scores zero when there is nothing to match', () => {
    expect(memoryRelevance(base, '')).toBe(0);
    expect(memoryRelevance(base, 'the and of it')).toBe(0);
  });
});
