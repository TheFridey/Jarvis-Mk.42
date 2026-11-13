import { describe, expect, it } from 'vitest';
import { describeDates, describeStructure, formatAnswer, readableAnswer } from './response-format.ts';

/** Entirely synthetic records: no customer, invoice or business data from any system. */
const SYNTHETIC = {
  generatedAt: '2026-11-13T09:00:00.000Z',
  records: [
    { ref: 'TEST-0001', state: 'open', amount: 1200, dueAt: '2026-12-01T00:00:00.000Z' },
    { ref: 'TEST-0002', state: 'paid', amount: 800, dueAt: '2026-11-20T00:00:00.000Z' },
  ],
};

describe('response formatting', () => {
  it('leaves pure prose untouched', () => {
    const prose = 'I am JARVIS. I coordinate authorised work on this machine.';
    expect(formatAnswer(prose)).toMatchObject({ reformatted: false, segments: [{ kind: 'prose', text: prose }] });
    expect(readableAnswer(prose)).toBe(prose);
  });

  it('separates prose from a structured block and keeps the raw text', () => {
    const answer = `Situation as of ${SYNTHETIC.generatedAt}.\n${JSON.stringify(SYNTHETIC.records)}\nNothing else is certified healthy.`;
    const formatted = formatAnswer(answer);
    expect(formatted.reformatted).toBe(true);
    expect(formatted.raw).toBe(answer);
    expect(formatted.segments.map(segment => segment.kind)).toEqual(['prose', 'structured', 'prose']);
    const block = formatted.segments[1];
    if (block?.kind !== 'structured') throw new Error('expected structured');
    expect(block.summary).toContain('2 records');
    expect(block.summary).toContain('ref');
    expect(block.timestamps).toEqual(['2026-11-20T00:00:00.000Z', '2026-12-01T00:00:00.000Z']);
    expect(block.source).toBe(JSON.stringify(SYNTHETIC.records));
    expect(block.pretty).toContain('"ref": "TEST-0001"');
  });

  it('does not invent values or drop content', () => {
    const answer = `Header.\n${JSON.stringify(SYNTHETIC.records)}`;
    const formatted = formatAnswer(answer);
    const block = formatted.segments[1];
    if (block?.kind !== 'structured') throw new Error('expected structured');
    // The pretty body is a pure reformat: the same values, in the same order.
    expect(JSON.parse(block.pretty)).toEqual(SYNTHETIC.records);
    expect(formatted.segments[0]).toMatchObject({ kind: 'prose', text: 'Header.' });
  });

  it('keeps unbalanced braces literal instead of swallowing the rest of the answer', () => {
    const answer = 'Partial {not json';
    expect(formatAnswer(answer).segments).toEqual([{ kind: 'prose', text: answer }]);
  });

  it('keeps prose that merely starts with a bracket readable', () => {
    const answer = '[2026-11-13] Standing by.';
    expect(formatAnswer(answer).reformatted).toBe(false);
  });

  it('names one date as an observation time and several as a range', () => {
    expect(describeDates([])).toBeUndefined();
    expect(describeDates([SYNTHETIC.generatedAt])).toBe(`as of ${SYNTHETIC.generatedAt}`);
    expect(describeDates([SYNTHETIC.generatedAt, '2026-12-01T00:00:00.000Z'])).toBe(`2 timestamps · ${SYNTHETIC.generatedAt} → 2026-12-01T00:00:00.000Z`);
    expect(describeDates([SYNTHETIC.generatedAt, SYNTHETIC.generatedAt])).toBe(`as of ${SYNTHETIC.generatedAt}`);
  });

  it('describes arrays and objects without asserting their contents', () => {
    expect(describeStructure(SYNTHETIC.records)).toBe('2 records · fields: ref, state, amount, dueAt');
    expect(describeStructure({ a: 1, b: 2 })).toBe('object · fields: a, b');
    expect(describeStructure('x')).toBe('string');
  });

  it('collapses a structured block to its summary for single-line use', () => {
    const answer = `Situation.\n${JSON.stringify({ generatedAt: SYNTHETIC.generatedAt, records: SYNTHETIC.records })}`;
    const line = readableAnswer(answer);
    expect(line).toContain('Situation.');
    expect(line).toContain('object · fields: generatedAt, records');
    expect(line).toContain('3 timestamps');
    expect(line).not.toContain('"ref"');
  });

  it('handles empty and whitespace-only answers', () => {
    expect(formatAnswer('')).toMatchObject({ segments: [], reformatted: false });
    expect(formatAnswer('   \n ').segments).toEqual([]);
    expect(formatAnswer(undefined).segments).toEqual([]);
  });
});
