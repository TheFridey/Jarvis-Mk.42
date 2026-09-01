import { describe, expect, it } from 'vitest';
import type { NotificationRequest } from '@jarvis/contracts';
import { decideDisposition, type GateContext } from './interruption-policy.ts';

const req = (over: Partial<NotificationRequest> = {}): NotificationRequest => ({
  source: 'test',
  principalId: 'p',
  severity: 'notice',
  urgency: 'normal',
  title: 't',
  body: 'b',
  dedupeKey: 'k',
  correlationId: 'c',
  ...over,
});

const ctx = (over: Partial<GateContext> = {}): GateContext => ({
  mode: 'ENGAGED',
  userFocused: false,
  isDuplicate: false,
  noSurface: false,
  ...over,
});

describe('interruption policy', () => {
  it('suppresses duplicates', () => {
    const d = decideDisposition(req(), ctx({ isDuplicate: true }));
    expect(d.disposition).toBe('suppressed');
  });

  it('critical+immediate always delivers (safety valve), even in DORMANT', () => {
    const d = decideDisposition(req({ severity: 'critical', urgency: 'immediate' }), ctx({ mode: 'DORMANT' }));
    expect(d.disposition).toBe('delivered');
  });

  it('batches info-level notifications in AMBIENT', () => {
    const d = decideDisposition(req({ severity: 'info' }), ctx({ mode: 'AMBIENT' }));
    expect(d.disposition).toBe('batched');
  });

  it('lets a warning through in FOCUSED (mode bar) but batches low urgency when the user is focused', () => {
    const passesBar = decideDisposition(req({ severity: 'warning', urgency: 'urgent' }), ctx({ mode: 'FOCUSED', userFocused: true }));
    expect(passesBar.disposition).toBe('delivered');
    const lowUrgency = decideDisposition(req({ severity: 'warning', urgency: 'normal' }), ctx({ mode: 'FOCUSED', userFocused: true }));
    expect(lowUrgency.disposition).toBe('batched');
  });

  it('queues when no surface is connected but the notification passed the gate', () => {
    const d = decideDisposition(req({ severity: 'warning', urgency: 'urgent' }), ctx({ noSurface: true }));
    expect(d.disposition).toBe('queued');
  });

  it('GUARDIAN lets warnings through', () => {
    const d = decideDisposition(req({ severity: 'warning' }), ctx({ mode: 'GUARDIAN' }));
    expect(d.disposition).toBe('delivered');
  });
});
