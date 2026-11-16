import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Guard against a silent structural loss in the Presence stylesheet.
 *
 * This file exists because it happened: an edit replaced 213 of its 243 lines with a single
 * new block, the build happily emitted the remainder, and Presence rendered for 394 pixels
 * in normal document flow with its controls uncovered by the canvas. Nothing failed — the
 * app still compiled, the Command Centre still looked right, and only a browser could show
 * it. These assertions are about the rules that must exist for the overlay to be an overlay.
 */
const css = readFileSync(new URL('../../app/presence.css', import.meta.url), 'utf8');

const REQUIRED: Array<[string, RegExp]> = [
  ['overlay is fixed and above the canvas', /\.presence-layer\{[^}]*position:fixed[^}]*inset:0[^}]*z-index:\d+/],
  ['overlay itself ignores pointer events, children opt in', /\.presence-layer\{[^}]*pointer-events:none/],
  ['the response stack positions itself', /\.presence-stack\{[^}]*position:/],
  ['the input row exists', /\.presence-input/],
  ['privacy chip exists', /\.presence-privacy/],
  ['satellites exist', /\.presence-satellites/],
  ['word block exists', /\.presence-word-block/],
  ['detail line exists', /\.presence-detail/],
  ['reduced motion is honoured', /prefers-reduced-motion/],
  ['focus is visible', /focus-visible/],
];

describe('presence stylesheet integrity', () => {
  it('keeps every structural rule the overlay depends on', () => {
    const missing = REQUIRED.filter(([, pattern]) => !pattern.test(css)).map(([name]) => name);
    expect(missing).toEqual([]);
  });

  it('has not been truncated: the sheet is a real stylesheet, not one appended block', () => {
    const rules = (css.match(/\{/g) ?? []).length;
    expect(rules).toBeGreaterThan(80);
    expect(css.length).toBeGreaterThan(6000);
  });

  it('declares the response and approval surfaces, not only the newest chip', () => {
    for (const selector of ['.presence-answer', '.presence-evidence', '.presence-reconnect']) {
      expect(css).toContain(selector);
    }
  });
});
