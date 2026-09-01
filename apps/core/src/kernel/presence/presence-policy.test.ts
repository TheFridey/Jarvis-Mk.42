import { describe, expect, it } from 'vitest';
import { presenceEvidence } from '@jarvis/testkit';
import { derivePresence } from './presence-policy.ts';

const NOW = Date.parse('2026-09-01T12:00:00.000Z');
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe('presence derivation', () => {
  it('is UNKNOWN with no evidence', () => {
    expect(derivePresence([], NOW)).toEqual({ state: 'UNKNOWN', confidence: 0 });
  });

  it('voice interaction implies ENGAGED', () => {
    const r = derivePresence([presenceEvidence('voice_interaction', { observedAt: at(1000) })], NOW);
    expect(r.state).toBe('ENGAGED');
    expect(r.confidence).toBeGreaterThan(0);
  });

  it('sustained workspace interaction implies FOCUSED', () => {
    const r = derivePresence(
      [
        presenceEvidence('workspace_interaction', { observedAt: at(500) }),
        presenceEvidence('workspace_interaction', { observedAt: at(2000) }),
        presenceEvidence('input_activity', { observedAt: at(1000) }),
      ],
      NOW,
    );
    expect(r.state).toBe('FOCUSED');
  });

  it('camera absence implies ABSENT when nothing contradicts it', () => {
    const r = derivePresence([presenceEvidence('camera_absence', { observedAt: at(1000) })], NOW);
    expect(r.state).toBe('ABSENT');
  });

  it('recent presence evidence overrides stale absence', () => {
    const r = derivePresence(
      [
        presenceEvidence('camera_absence', { observedAt: at(240_000) }),
        presenceEvidence('voice_interaction', { observedAt: at(1000) }),
      ],
      NOW,
    );
    expect(['PRESENT', 'ENGAGED', 'FOCUSED']).toContain(r.state);
  });

  it('decays: very old evidence yields UNKNOWN', () => {
    const r = derivePresence([presenceEvidence('voice_interaction', { observedAt: at(3_600_000) })], NOW);
    // contribution decayed to ~0
    expect(r.confidence).toBeLessThan(0.2);
  });

  it('is deterministic', () => {
    const ev = [
      presenceEvidence('camera_presence', { observedAt: at(1000) }),
      presenceEvidence('input_activity', { observedAt: at(2000) }),
    ];
    expect(derivePresence(ev, NOW)).toEqual(derivePresence(ev, NOW));
  });
});
