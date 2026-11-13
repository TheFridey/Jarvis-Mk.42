import { describe, expect, it } from 'vitest';
import {
  categoryHintFor, rememberRequest, selectMemories, type MemoryRecord,
} from './personal-memory.ts';

/**
 * Broad requests and explicit memory requests.
 *
 * The point of the first half: a synthetic milestone statement never contains the words "hype"
 * or "journey", so only category awareness can retrieve it — and nothing else may come with it.
 */

const milestone = (id: string, category: MemoryRecord['category'], statement: string): MemoryRecord => ({
  id, principalId: 'principal-a', category, subject: 'project note', statement,
  source: 'synthetic', confidence: 0.9, privacyClass: 'INTERNAL', cloudEligible: true,
  reviewStatus: 'approved', recordedAt: '2026-11-01T00:00:00.000Z',
});

const memory = [
  milestone('m1', 'milestone', 'Shipped the first paid client deployment in October.'),
  milestone('m2', 'ambition', 'Wants a business that does not depend on a single client.'),
  milestone('m3', 'preference', 'Prefers short technical summaries.'),
];

describe('category-aware retrieval', () => {
  it('recognises a broad request rather than keywords', () => {
    expect(categoryHintFor('Time for a hype session.')).toContain('milestone');
    expect(categoryHintFor('How far have we come?')).toContain('decision');
    expect(categoryHintFor('What should we work on tonight?')).toContain('project');
    expect(categoryHintFor('What do you know about me?')).toContain('preference');
    expect(categoryHintFor('Evening Jarvis.')).toBeUndefined();
    expect(categoryHintFor('Girls on Film!')).toBeUndefined();
  });

  it('retrieves synthetic milestones for a hype request without any keyword overlap', () => {
    const { selected } = selectMemories({ records: memory, query: 'Time for a hype session.', principalId: 'principal-a', locality: 'local', categories: categoryHintFor('Time for a hype session.') });
    const ids = selected.map(entry => entry.record.id);
    expect(ids).toContain('m1');
    expect(ids).toContain('m2');
    // A communication preference is not part of a hype reflection.
    expect(ids).not.toContain('m3');
  });

  it('retrieves nothing for a greeting or a music reference, category hint or not', () => {
    const greeting = selectMemories({ records: memory, query: 'Evening Jarvis.', principalId: 'principal-a', locality: 'local', categories: categoryHintFor('Evening Jarvis.') });
    expect(greeting.selected).toEqual([]);
    const music = selectMemories({ records: memory, query: 'Girls on Film!', principalId: 'principal-a', locality: 'local', categories: categoryHintFor('Girls on Film!') });
    expect(music.selected).toEqual([]);
  });

  it('keeps the privacy ceiling when a broad request is answered', () => {
    const private_ = { ...milestone('m4', 'milestone', 'Shipped the client deployment.'), privacyClass: 'SENSITIVE' as const };
    const cloud = selectMemories({ records: [private_], query: 'Time for a hype session.', principalId: 'principal-a', locality: 'cloud', categories: categoryHintFor('Time for a hype session.') });
    expect(cloud.selected).toEqual([]);
    expect(cloud.excluded[0]!.reason).toBe('cloud_ineligible');
  });

  it('still bounds the count for a broad request', () => {
    const many = Array.from({ length: 12 }, (_, index) => milestone(`x${index}`, 'milestone', 'Progress on the build.'));
    const { selected, excluded } = selectMemories({ records: many, query: 'Time for a hype session.', principalId: 'principal-a', locality: 'local', categories: categoryHintFor('Time for a hype session.') });
    expect(selected.length).toBeLessThanOrEqual(6);
    expect(excluded.some(entry => entry.reason === 'budget')).toBe(true);
  });
});

describe('explicit memory requests', () => {
  it('accepts a real request', () => {
    expect(rememberRequest('Remember that I prefer detailed engineering reports when I ask for them.')).toBe('I prefer detailed engineering reports when I ask for them.');
  });

  it('refuses negation, hypotheticals and pretend', () => {
    expect(rememberRequest("Don't remember that.")).toBeUndefined();
    expect(rememberRequest('Remember: imagine I preferred concise summaries.')).toBeUndefined();
    expect(rememberRequest('Remember that if I said I liked tea, that would be wrong.')).toBeUndefined();
    expect(rememberRequest('Pretend you remembered this.')).toBeUndefined();
  });

  it('does not treat ordinary statements as memory requests', () => {
    expect(rememberRequest('I prefer concise summaries.')).toBeUndefined();
    expect(rememberRequest('Evening Jarvis.')).toBeUndefined();
    expect(rememberRequest('Do you remember the Aurora codename?')).toBeUndefined();
  });

  it('bounds what one request may store', () => {
    const long = rememberRequest('Remember that ' + 'x'.repeat(5000));
    expect(long?.length).toBe(2000);
  });
});
