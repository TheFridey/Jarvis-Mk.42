import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registerFor } from './assistant-identity.ts';

/**
 * The evaluation dataset is a contract, not a scorecard.
 *
 * These assertions check the dataset itself: that it covers the categories the operation
 * asked for, that every case states what good conduct looks like, and that the register each
 * case claims is the register the running heuristic actually assigns. They deliberately do
 * not judge whether a reply is funny, warm or intelligent — no fixture can, and claiming
 * otherwise would be the exact dishonesty this suite exists to prevent.
 */

interface Case { id: string; category: string; register: string; turns: string[]; expect: string[] }
const dataset = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../../docs/evaluation/conversation-cases.json', import.meta.url)), 'utf8')) as { version: number; dimensions: string[]; cases: Case[] };

describe('behavioural evaluation dataset', () => {
  it('has at least sixty cases', () => {
    expect(dataset.cases.length).toBeGreaterThanOrEqual(60);
  });

  it('covers every required category', () => {
    const categories = new Set(dataset.cases.map(entry => entry.category));
    for (const required of [
      'greeting', 'casual', 'humour', 'music', 'film', 'gaming', 'science', 'business',
      'engineering', 'hype', 'setback', 'celebration', 'memory', 'memory_correction',
      'uncertainty', 'action', 'privacy', 'transition', 'continuity', 'family', 'voice',
    ]) expect(categories.has(required), `missing category: ${required}`).toBe(true);
  });

  it('includes multi-turn scenarios', () => {
    expect(dataset.cases.filter(entry => entry.turns.length > 1).length).toBeGreaterThanOrEqual(3);
  });

  it('states expected conduct for every case, never an exact reply', () => {
    for (const entry of dataset.cases) {
      expect(entry.expect.length, entry.id).toBeGreaterThan(0);
      // An exact expected reply would be a script, which the brief forbids.
      expect(Object.keys(entry).sort()).toEqual(['category', 'expect', 'id', 'register', 'turns']);
    }
  });

  it('uses unique identifiers', () => {
    expect(new Set(dataset.cases.map(entry => entry.id)).size).toBe(dataset.cases.length);
  });

  it('claims a register the running heuristic agrees with', () => {
    const disagreements = dataset.cases
      .filter(entry => entry.turns.length === 1 && registerFor(entry.turns[0]!) !== entry.register)
      .map(entry => `${entry.id}: dataset ${entry.register}, heuristic ${registerFor(entry.turns[0]!)}`);
    expect(disagreements).toEqual([]);
  });

  it('publishes review dimensions and records no scores', () => {
    expect(dataset.dimensions.length).toBeGreaterThanOrEqual(12);
    expect(dataset).not.toHaveProperty('scores');
  });
});
