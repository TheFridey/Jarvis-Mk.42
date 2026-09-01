/**
 * Mode transition policy (ADR-0019). PURE and deterministic: same
 * (from, request) always yields the same decision. No I/O, no clock, no
 * randomness. Guards are evaluated against caller-supplied context.
 *
 * A mode change may only STRENGTHEN authority downstream, never weaken it - so
 * there is no path here that grants anything; this only decides posture.
 */
import {
  LEGAL_MODE_TRANSITIONS,
  type JarvisMode,
  type ModeTransitionDecision,
  type ModeTransitionRequest,
} from '@jarvis/contracts';

export function decideTransition(
  from: JarvisMode,
  req: ModeTransitionRequest,
): ModeTransitionDecision {
  if (from === req.to) {
    return { allowed: false, code: 'same_mode', detail: `already in ${from}` };
  }

  const legal = LEGAL_MODE_TRANSITIONS[from];
  if (!legal.includes(req.to)) {
    return {
      allowed: false,
      code: 'illegal_transition',
      detail: `${from} -> ${req.to} is not a legal transition`,
    };
  }

  const ctx = req.context ?? {};

  // Guard: -> AUTONOMOUS requires no active user presence + >=1 active objective.
  if (req.to === 'AUTONOMOUS') {
    if (ctx.presencePresent) {
      return { allowed: false, code: 'guard_presence', detail: 'cannot enter AUTONOMOUS while the principal is present' };
    }
    if ((ctx.activeObjectiveCount ?? 0) < 1) {
      return { allowed: false, code: 'guard_objective', detail: 'AUTONOMOUS requires at least one active objective' };
    }
  }

  // Guard: leaving DEGRADED for a healthy mode requires critical deps healthy.
  if (from === 'DEGRADED' && req.to !== 'GUARDIAN') {
    if (!ctx.criticalDepsHealthy) {
      return { allowed: false, code: 'guard_health', detail: 'cannot leave DEGRADED until critical dependencies are healthy' };
    }
    if (ctx.minDwellElapsed === false) {
      return { allowed: false, code: 'guard_dwell', detail: 'minimum dwell time in DEGRADED has not elapsed (hysteresis)' };
    }
  }

  // Guard: leaving GUARDIAN requires an explicit security clear.
  if (from === 'GUARDIAN') {
    if (!ctx.securityCleared) {
      return { allowed: false, code: 'guard_security_clear', detail: 'GUARDIAN can only be left after an explicit security.cleared' };
    }
  }

  return { allowed: true };
}

/** The subset of triggers that may drive ANY -> DEGRADED / GUARDIAN. */
export function isEmergencyTrigger(to: JarvisMode): boolean {
  return to === 'DEGRADED' || to === 'GUARDIAN';
}
