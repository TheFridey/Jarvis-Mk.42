import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PresenceMode } from './presence-mode.tsx';
import { presenceComposition, presenceZones, type PresenceReadout } from './presence-policy.ts';

/**
 * What actually ships: the composed component, rendered with synthetic records.
 * Unit tests prove the formatter's decisions; this proves the interface uses them,
 * so "the built export shows raw JSON" becomes a test failure, not a screenshot.
 */

const readout = {
  state: 'STANDBY', word: 'STANDBY', detail: 'Standing by.', tone: 'calm',
  speaking: false, listening: false, verified: false,
} as unknown as PresenceReadout;

const composition = presenceComposition({ width: 1856, height: 890 });
const props = (answer?: string) => ({
  readout,
  liveness: { status: 'live' as const, current: true, synthetic: false, label: 'REALTIME LIVE' },
  composition,
  zones: presenceZones({ width: 1856, height: 890 }, composition),
  satellites: [],
  inputEnabled: true,
  reducedMotion: true,
  rendererFallback: false,
  ...(answer !== undefined ? { answer } : {}),
  onAsk: () => undefined,
  onDismissAnswer: () => undefined,
  onCommandCentre: () => undefined,
});

/** Synthetic, in the shape the Kernel's business path produces. */
const SYNTHETIC_RECORDS = [{ ref: 'TEST-0001', state: 'open', amount: 1200, dueAt: '2026-12-01T00:00:00.000Z' }];
const render = (answer?: string) => renderToStaticMarkup(createElement(PresenceMode as never, props(answer) as never));

describe('response presentation (rendered component)', () => {
  it('renders prose as prose and structured evidence collapsed', () => {
    const answer = `Situation as of 2026-11-13T09:00:00.000Z.\n${JSON.stringify(SYNTHETIC_RECORDS)}\nNothing else is certified healthy.`;
    const html = render(answer);

    expect(html).toContain('presence-evidence');
    expect(html).toContain('Situation as of');
    expect(html).toContain('Nothing else is certified healthy.');
    expect(html).toMatch(/<details class="presence-evidence">/);
    expect(html).not.toMatch(/<details[^>]*open/);
    expect(html).toContain('TEST-0001');
    expect(html).toContain('1 record');
    expect(html).toContain('as of 2026-12-01T00:00:00.000Z');
  });

  it('never prints raw JSON as the default conversational text', () => {
    const html = render(JSON.stringify(SYNTHETIC_RECORDS));
    const outsideEvidence = html.replace(/<pre>[\s\S]*?<\/pre>/g, '');
    expect(outsideEvidence).not.toContain('"ref"');
    expect(outsideEvidence).not.toContain('TEST-0001');
  });

  it('keeps a plain answer unchanged', () => {
    const html = render('I am JARVIS.');
    expect(html).toContain('I am JARVIS.');
    expect(html).not.toContain('presence-evidence');
  });

  it('renders nothing conversational without an answer', () => {
    expect(render()).not.toContain('presence-answer-body');
  });
});
