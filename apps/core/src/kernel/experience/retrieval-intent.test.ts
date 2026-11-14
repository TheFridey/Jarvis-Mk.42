import { describe, expect, it } from 'vitest';
import { retrievalIntentFor, entityKey } from './retrieval-intent.ts';
import { composeMemoryContext, recallDiagnostics, retrievalBudgetFor, selectMemories, type MemoryCategory, type MemoryRecord } from './personal-memory.ts';

/**
 * Retrieval intent, diversity and honesty of scope.
 *
 * The live failure: "mate, tell me everything you know about my previous career" was budgeted by
 * conversational register, so CASUAL granted two records, and the model — holding two — said that
 * was the whole record. Register is tone; intent is evidence.
 */

const memory = (id: string, category: MemoryCategory, subject: string, statement: string, over: Partial<MemoryRecord> = {}): MemoryRecord => ({
  id, principalId: 'owner', category, subject, statement, source: 'synthetic', confidence: 0.9,
  privacyClass: 'INTERNAL', cloudEligible: true, reviewStatus: 'approved',
  recordedAt: '2026-11-01T00:00:00.000Z', ...over,
});

// A synthetic professional life: four distinct careers, three projects, plus preferences.
const profile: MemoryRecord[] = [
  memory('h1', 'history', 'restaurant', 'Ran a restaurant kitchen before anything else.'),
  memory('h2', 'history', 'streaming', 'Streamed games competitively for a couple of years.'),
  memory('h3', 'history', 'esports organisation', 'Founded and ran an esports organisation.'),
  memory('h4', 'history', 'software business', 'Builds and sells software products now.'),
  memory('s1', 'skill', 'backend engineering', 'Strong backend engineer, TypeScript and Postgres.'),
  memory('p1', 'project', 'sales pipeline', 'Rebuilding the sales pipeline around repeatable outreach.'),
  memory('p2', 'project', 'procurement bid', 'Submitted a public-sector tender.'),
  memory('p3', 'project', 'delivery tooling', 'Building internal delivery tooling.'),
  memory('m1', 'milestone', 'first paid client', 'Delivered the first paid client deployment.'),
  memory('a1', 'ambition', 'research lab', 'Wants a self-sustaining R&D operation.'),
  memory('c1', 'communication', 'answer length', 'Prefers concise answers unless detail is requested.'),
  memory('i1', 'interest', 'eighties music', 'Enjoys eighties British pop.'),
  memory('x1', 'preference', 'local only note', 'A private remark.', { privacyClass: 'SENSITIVE', cloudEligible: false }),
];

describe('retrieval intent', () => {
  it('separates register from evidence requirement', () => {
    expect(retrievalIntentFor('Morning mate!').intent).toBe('SOCIAL');
    expect(retrievalIntentFor('Mate, tell me everything you know about my previous career.').intent).toBe('COMPREHENSIVE_RECALL');
    expect(retrievalIntentFor('What did I do before founding ScaleSmiths?').intent).toBe('CAREER_HISTORY');
    expect(retrievalIntentFor('Right, business mode. What projects are we working on?').intent).toBe('PROJECT_INVENTORY');
    expect(retrievalIntentFor('How far have we come recently?').intent).toBe('RECENT_PROGRESS');
    expect(retrievalIntentFor('Give me a proper hype session. Go deep.').intent).toBe('ENCOURAGEMENT');
    expect(retrievalIntentFor('What do you actually know about me?').intent).toBe('PROFILE_OVERVIEW');
    expect(retrievalIntentFor("What's the difference between ionic and covalent bonding?").intent).toBe('GENERAL_KNOWLEDGE');
    expect(retrievalIntentFor("What else haven't you mentioned?").intent).toBe('FOLLOW_UP');
  });

  it('gives a casually phrased comprehensive question a wide ceiling', () => {
    const casual = retrievalBudgetFor('Morning mate!');
    const career = retrievalBudgetFor('Mate, tell me everything you know about my previous career.');
    expect(casual.limit).toBeLessThanOrEqual(2);
    expect(career.limit).toBeGreaterThanOrEqual(15);
  });

  it('never asks for memory on a general-knowledge question', () => {
    expect(composeMemoryContext(profile, { query: "What's the difference between ionic and covalent bonding?", principalId: 'owner', locality: 'cloud' })).toBe('');
  });
});

describe('diversity', () => {
  it('groups one subject together and keeps related subjects apart', () => {
    expect(entityKey('Current project')).toBe('current project');
    expect(entityKey('esports organisation')).toBe('esports organisation');
  });

  it('returns distinct careers for a broad career question', () => {
    const plan = retrievalIntentFor('What did I do before founding ScaleSmiths?');
    const { selected } = selectMemories({ records: profile, query: 'What did I do before founding ScaleSmiths?', principalId: 'owner', locality: 'cloud', categories: plan.categories, limit: plan.limit, minScore: plan.minScore, diversify: plan.diversify });
    const subjects = new Set(selected.map(entry => entityKey(entry.record.subject)));
    expect(subjects.size).toBeGreaterThanOrEqual(3);
  });

  it('prefers one fact about four projects over four facts about one', () => {
    const clustered = [
      ...Array.from({ length: 6 }, (_, index) => memory(`d${index}`, 'project', 'sales pipeline', `Sales detail ${index}.`)),
      memory('other1', 'project', 'procurement bid', 'Tender submitted.'),
      memory('other2', 'project', 'delivery tooling', 'Tooling built.'),
    ];
    const plan = retrievalIntentFor('What projects are we working on?');
    const { selected } = selectMemories({ records: clustered, query: 'What projects are we working on?', principalId: 'owner', locality: 'local', categories: plan.categories, limit: plan.limit, minScore: plan.minScore, diversify: true });
    const distinct = new Set(selected.map(entry => entityKey(entry.record.subject)));
    expect(distinct.size).toBeGreaterThanOrEqual(3);
  });

  it('spreads a profile question across categories', () => {
    const plan = retrievalIntentFor('What do you actually know about me?');
    const { selected } = selectMemories({ records: profile, query: 'What do you actually know about me?', principalId: 'owner', locality: 'cloud', categories: plan.categories, limit: plan.limit, minScore: plan.minScore, diversify: true });
    expect(new Set(selected.map(entry => entry.record.category)).size).toBeGreaterThanOrEqual(3);
  });
});

describe('honesty of scope', () => {
  it('says the view is partial instead of implying it is everything', () => {
    const block = composeMemoryContext(profile, { query: 'What do you actually know about me?', principalId: 'owner', locality: 'cloud' });
    expect(block).toMatch(/partial/);
    expect(block).toMatch(/of \d+ eligible records/);
    expect(block).not.toContain('this is everything');
  });

  it('omits SENSITIVE records from a cloud block', () => {
    const block = composeMemoryContext(profile, { query: 'What do you actually know about me?', principalId: 'owner', locality: 'cloud' });
    expect(block).not.toContain('private remark');
  });

  it('reports intent, ceiling and diversity in diagnostics without content', () => {
    const diag = recallDiagnostics({ records: profile, query: 'What do you actually know about me?', principalId: 'owner', locality: 'cloud' });
    expect(diag.intent).toBe('PROFILE_OVERVIEW');
    expect(diag.limit).toBeGreaterThan(2);
    expect(diag.distinctEntities).toBeGreaterThan(0);
    expect(diag.estimatedTokens).toBeGreaterThan(0);
    expect(JSON.stringify(diag)).not.toContain('private remark');
  });

  it('keeps a greeting to at most a communication preference, never autobiography', () => {
    const block = composeMemoryContext(profile, { query: 'Morning mate!', principalId: 'owner', locality: 'cloud' });
    const lines = block.split(String.fromCharCode(10)).filter(line => line.startsWith('- '));
    expect(lines.length).toBeLessThanOrEqual(2);
    expect(block).not.toContain('esports organisation');
    expect(block).not.toContain('restaurant kitchen');
  });
});

describe('memory context ceiling', () => {
  const long = (id: string, subject: string, size: number) => memory(id, 'milestone', subject, 'SENTINEL ' + 'detail '.repeat(Math.ceil(size / 7)));

  it('keeps a broad answer inside its token ceiling even with long records', () => {
    const records = Array.from({ length: 12 }, (_, index) => long(`L${index}`, `entity-${index}`, 4000));
    const block = composeMemoryContext(records, { query: 'What do you actually know about me?', principalId: 'owner', locality: 'local' });
    // PROFILE_OVERVIEW ceiling is 2000 tokens; the header adds a little.
    expect(Math.ceil(block.length / 4)).toBeLessThan(2600);
    expect(block.split(String.fromCharCode(10)).filter(line => line.startsWith('- ')).length).toBeGreaterThan(0);
  });

  it('never truncates a statement mid-sentence', () => {
    const records = [long('one', 'single', 9000)];
    const block = composeMemoryContext(records, { query: 'What do you actually know about me?', principalId: 'owner', locality: 'local' });
    for (const line of block.split(String.fromCharCode(10)).filter(entry => entry.startsWith('- '))) {
      expect(line.trimEnd().endsWith('detail')).toBe(true);
    }
  });

  it('keeps diversity under budget pressure rather than one long record', () => {
    const records = [long('big', 'one-entity', 6000), memory('b', 'milestone', 'second-entity', 'Short fact.'), memory('c', 'milestone', 'third-entity', 'Another fact.')];
    const block = composeMemoryContext(records, { query: 'What do you actually know about me?', principalId: 'owner', locality: 'local' });
    expect(block).toContain('second-entity');
  });
});


describe('ceiling edge cases', () => {
  it('omits a record larger than the whole budget instead of exceeding it', () => {
    const huge = memory('huge', 'milestone', 'huge-entity', 'SENTINEL ' + 'word '.repeat(6000));
    const block = composeMemoryContext([huge], { query: 'What do you actually know about me?', principalId: 'owner', locality: 'local' });
    // Nothing fits the 2,000-token ceiling, so nothing is sent rather than a truncated fact.
    expect(block).toBe('');
  });

  it('keeps smaller records when a large one cannot fit', () => {
    const huge = memory('huge', 'milestone', 'huge-entity', 'SENTINEL ' + 'word '.repeat(4000));
    const small = memory('small', 'milestone', 'small-entity', 'A short fact about delivery.');
    const block = composeMemoryContext([huge, small], { query: 'What do you actually know about me?', principalId: 'owner', locality: 'local' });
    expect(block).toContain('small-entity');
    expect(Math.ceil(block.length / 4)).toBeLessThanOrEqual(2100);
  });

  it('counts multibyte text honestly', () => {
    const emoji = memory('e', 'milestone', 'multibyte', 'SENTINEL ' + '🎯'.repeat(2000));
    const block = composeMemoryContext([emoji], { query: 'What do you actually know about me?', principalId: 'owner', locality: 'local' });
    // UTF-16 length, not code points: the estimate is conservative rather than optimistic.
    expect(block.length === 0 || block.length <= 8400).toBe(true);
  });

  it('never sends memory on a zero-budget intent', () => {
    const records = [memory('a', 'history', 'career', 'SENTINEL history.')];
    expect(composeMemoryContext(records, { query: "What's the difference between ionic and covalent bonds?", principalId: 'owner', locality: 'local' })).toBe('');
  });
});
