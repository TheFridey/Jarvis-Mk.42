import { describe, expect, it } from 'vitest';
import { cronMatches } from './cron.ts';

// 2026-09-01 is a Tuesday (getDay() === 2).
const d = (s: string) => new Date(s);

describe('cron matcher', () => {
  it('matches "* * * * *" always', () => {
    expect(cronMatches('* * * * *', d('2026-09-01T13:37:00'))).toBe(true);
  });

  it('matches a specific minute + hour', () => {
    expect(cronMatches('30 9 * * *', d('2026-09-01T09:30:00'))).toBe(true);
    expect(cronMatches('30 9 * * *', d('2026-09-01T09:31:00'))).toBe(false);
  });

  it('supports step values', () => {
    expect(cronMatches('*/15 * * * *', d('2026-09-01T10:45:00'))).toBe(true);
    expect(cronMatches('*/15 * * * *', d('2026-09-01T10:46:00'))).toBe(false);
  });

  it('supports ranges and lists', () => {
    expect(cronMatches('0 9-17 * * *', d('2026-09-01T12:00:00'))).toBe(true);
    expect(cronMatches('0 9-17 * * *', d('2026-09-01T18:00:00'))).toBe(false);
    expect(cronMatches('0 0 * * 1,2,3', d('2026-09-01T00:00:00'))).toBe(true); // Tue
    expect(cronMatches('0 0 * * 6,0', d('2026-09-01T00:00:00'))).toBe(false);
  });

  it('supports range-step', () => {
    expect(cronMatches('0-30/10 * * * *', d('2026-09-01T10:20:00'))).toBe(true);
    expect(cronMatches('0-30/10 * * * *', d('2026-09-01T10:25:00'))).toBe(false);
  });

  it('throws on a malformed expression', () => {
    expect(() => cronMatches('* * *', d('2026-09-01T00:00:00'))).toThrow();
  });
});
