import { describe, expect, it } from 'vitest';
import { JARVIS_MODES, LEGAL_MODE_TRANSITIONS, type JarvisMode } from '@jarvis/contracts';
import { decideTransition } from './transition-policy.ts';

const okCtx = {
  presencePresent: false,
  activeObjectiveCount: 1,
  criticalDepsHealthy: true,
  securityCleared: true,
  minDwellElapsed: true,
};

describe('mode transition policy', () => {
  it('allows every transition in the legal table', () => {
    for (const from of JARVIS_MODES) {
      for (const to of LEGAL_MODE_TRANSITIONS[from]) {
        const d = decideTransition(from, { to, trigger: 'operator_request', reason: 't', context: okCtx });
        expect(d.allowed, `${from} -> ${to}`).toBe(true);
      }
    }
  });

  it('rejects every transition NOT in the legal table', () => {
    for (const from of JARVIS_MODES) {
      const legal = new Set<JarvisMode>([from, ...LEGAL_MODE_TRANSITIONS[from]]);
      for (const to of JARVIS_MODES) {
        if (legal.has(to)) continue;
        const d = decideTransition(from, { to, trigger: 'operator_request', reason: 't', context: okCtx });
        expect(d.allowed, `${from} -> ${to} should be illegal`).toBe(false);
        if (!d.allowed) expect(d.code).toBe('illegal_transition');
      }
    }
  });

  it('rejects a same-mode "transition"', () => {
    const d = decideTransition('AMBIENT', { to: 'AMBIENT', trigger: 'operator_request', reason: 'x' });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe('same_mode');
  });

  it('ANY -> DEGRADED and ANY -> GUARDIAN are reachable from every non-emergency mode', () => {
    for (const from of ['DORMANT', 'AMBIENT', 'ENGAGED', 'FOCUSED', 'AUTONOMOUS'] as JarvisMode[]) {
      expect(decideTransition(from, { to: 'DEGRADED', trigger: 'dependency_unhealthy', reason: 'x', context: okCtx }).allowed).toBe(true);
      expect(decideTransition(from, { to: 'GUARDIAN', trigger: 'security_event', reason: 'x', context: okCtx }).allowed).toBe(true);
    }
  });

  it('blocks AUTONOMOUS while the principal is present', () => {
    const d = decideTransition('AMBIENT', {
      to: 'AUTONOMOUS',
      trigger: 'objective_activated',
      reason: 'x',
      context: { ...okCtx, presencePresent: true },
    });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe('guard_presence');
  });

  it('blocks AUTONOMOUS with no active objective', () => {
    const d = decideTransition('AMBIENT', {
      to: 'AUTONOMOUS',
      trigger: 'objective_activated',
      reason: 'x',
      context: { ...okCtx, activeObjectiveCount: 0 },
    });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe('guard_objective');
  });

  it('blocks leaving DEGRADED until critical deps are healthy', () => {
    const d = decideTransition('DEGRADED', {
      to: 'AMBIENT',
      trigger: 'dependency_recovered',
      reason: 'x',
      context: { ...okCtx, criticalDepsHealthy: false },
    });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe('guard_health');
  });

  it('enforces dwell hysteresis when leaving DEGRADED', () => {
    const d = decideTransition('DEGRADED', {
      to: 'AMBIENT',
      trigger: 'dependency_recovered',
      reason: 'x',
      context: { ...okCtx, minDwellElapsed: false },
    });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe('guard_dwell');
  });

  it('blocks leaving GUARDIAN without an explicit security clear', () => {
    const d = decideTransition('GUARDIAN', {
      to: 'AMBIENT',
      trigger: 'security_cleared',
      reason: 'x',
      context: { ...okCtx, securityCleared: false },
    });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe('guard_security_clear');
  });

  it('allows DEGRADED -> GUARDIAN even with unhealthy deps (emergency escalation)', () => {
    const d = decideTransition('DEGRADED', {
      to: 'GUARDIAN',
      trigger: 'security_event',
      reason: 'x',
      context: { ...okCtx, criticalDepsHealthy: false },
    });
    expect(d.allowed).toBe(true);
  });
});
