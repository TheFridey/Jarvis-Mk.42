import { describe, expect, it } from 'vitest';
import { ReviewSession, parseDecision, type ReviewIo } from './memory-review.ts';
import type { MemoryRecord } from './personal-memory.ts';
import type { PersonalMemoryService } from './personal-memory-service.ts';

/**
 * Interactive review behaviour, without a terminal.
 *
 * The point of these cases is what must NOT happen: an empty line approving, an EOF approving, a
 * skip changing state, a failed write reported as success, or one principal's records appearing in
 * another's session.
 */

const record = (id: string, over: Partial<MemoryRecord> = {}): MemoryRecord => ({
  id, principalId: 'owner-a', category: 'preference', subject: `subject-${id}`, statement: `statement-${id}`,
  source: 'synthetic', confidence: 0.9, privacyClass: 'SENSITIVE', cloudEligible: false,
  reviewStatus: 'pending', recordedAt: '2026-11-01T00:00:00.000Z', ...over,
});

class FakeService {
  records: MemoryRecord[];
  failOn: Set<string>;
  persistFailures: Set<string>;
  constructor(records: MemoryRecord[]) { this.records = records; this.failOn = new Set(); this.persistFailures = new Set(); }
  async list(): Promise<MemoryRecord[]> { return this.records.map(entry => ({ ...entry })); }
  async approve(_principalId: string, id: string): Promise<void> {
    if (this.failOn.has(id)) throw new Error('database unavailable');
    this.records = this.records.map(entry => (entry.id === id && !this.persistFailures.has(id) ? { ...entry, reviewStatus: 'approved' as const } : entry));
  }
}

const scripted = (answers: string[]): { io: ReviewIo; lines: string[] } => {
  const lines: string[] = [];
  const queue = [...answers];
  return {
    lines,
    io: {
      write: line => lines.push(line),
      ask: async () => (queue.length ? queue.shift()! : '__eof__'),
    },
  };
};

const session = (service: FakeService, answers: string[]) => {
  const { io, lines } = scripted(answers);
  return { run: () => new ReviewSession(service as unknown as PersonalMemoryService, 'owner-a', io).run(), lines };
};

describe('review decisions', () => {
  it('parses only the documented keys', () => {
    expect(parseDecision('A')).toBe('approve');
    expect(parseDecision(' s ')).toBe('skip');
    expect(parseDecision('Q')).toBe('quit');
    expect(parseDecision('h')).toBe('help');
    expect(parseDecision('')).toBe('unknown');
    expect(parseDecision('yes please')).toBe('unknown');
  });
});

describe('review session', () => {
  it('approves only on an explicit A, and confirms against persisted state', async () => {
    const service = new FakeService([record('m1')]);
    const outcome = await session(service, ['a']).run();
    expect(outcome.approved).toEqual(['m1']);
    expect(service.records[0]!.reviewStatus).toBe('approved');
    expect(outcome.remaining).toBe(0);
  });

  it('never approves on an empty line', async () => {
    const service = new FakeService([record('m1')]);
    const outcome = await session(service, ['', 'q']).run();
    expect(outcome.approved).toEqual([]);
    expect(service.records[0]!.reviewStatus).toBe('pending');
  });

  it('skips without changing state', async () => {
    const service = new FakeService([record('m1')]);
    const outcome = await session(service, ['s', 'q']).run();
    expect(outcome.skipped).toEqual(['m1']);
    expect(service.records[0]!.reviewStatus).toBe('pending');
  });

  it('quits with no further changes', async () => {
    const service = new FakeService([record('m1'), record('m2')]);
    const outcome = await session(service, ['q']).run();
    expect(outcome.quit).toBe(true);
    expect(outcome.approved).toEqual([]);
    expect(service.records.every(entry => entry.reviewStatus === 'pending')).toBe(true);
  });

  it('treats a closed stdin as quit, not consent', async () => {
    const service = new FakeService([record('m1')]);
    const outcome = await session(service, []).run();
    expect(outcome.quit).toBe(true);
    expect(service.records[0]!.reviewStatus).toBe('pending');
  });

  it('reports a failed write instead of claiming success', async () => {
    const service = new FakeService([record('m1')]);
    service.failOn.add('m1');
    const outcome = await session(service, ['a', 'q']).run();
    expect(outcome.approved).toEqual([]);
    expect(outcome.errors[0]).toContain('database unavailable');
    expect(service.records[0]!.reviewStatus).toBe('pending');
  });

  it('reports a write that did not persist', async () => {
    const service = new FakeService([record('m1')]);
    service.persistFailures.add('m1');
    const outcome = await session(service, ['a', 'q']).run();
    expect(outcome.approved).toEqual([]);
    expect(outcome.errors[0]).toContain('not persisted');
  });

  it('reconciles a lost acknowledgement on the next pass', async () => {
    // The write landed but the caller saw an error; the record is approved in the database, so the
    // resume run simply finds nothing pending rather than approving twice.
    const service = new FakeService([record('m1', { reviewStatus: 'approved' })]);
    const outcome = await session(service, []).run();
    expect(outcome.emptyQueue).toBe(true);
    expect(outcome.active).toBe(1);
  });

  it('resumes from database state, not a local counter', async () => {
    const service = new FakeService([record('m1'), record('m2'), record('m3')]);
    const first = await session(service, ['a', 'q']).run();
    expect(first.remaining).toBe(2);
    const second = await session(service, ['a', 'q']).run();
    expect(second.approved).toEqual(['m2']);
    expect(second.remaining).toBe(1);
  });

  it('shows an empty queue without inventing work', async () => {
    const outcome = await session(new FakeService([]), []).run();
    expect(outcome.emptyQueue).toBe(true);
    expect(outcome.remaining).toBe(0);
  });

  it('asks the service only for its own principal', async () => {
    const calls: string[] = [];
    const service = new FakeService([record('mine')]);
    const spy = { list: async (principal: string) => { calls.push(principal); return service.list(); }, approve: async () => undefined };
    const { io } = scripted(['q']);
    await new ReviewSession(spy as unknown as PersonalMemoryService, 'owner-a', io).run();
    expect(calls.length).toBeGreaterThan(0);
    expect(new Set(calls)).toEqual(new Set(['owner-a']));
  });

  it('does not include statements in the session summary', async () => {
    const service = new FakeService([record('m1')]);
    const { run, lines } = session(service, ['a']);
    await run();
    const summary = lines.slice(-8).join(' ');
    expect(summary).toContain('Approved this session: 1');
    expect(summary).not.toContain('statement-m1');
  });
});
