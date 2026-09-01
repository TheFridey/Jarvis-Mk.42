/**
 * Interruption gate - PURE. Given a notification request + current context
 * (mode, user-focused?, recent dedupe hits) decides the disposition. No
 * subsystem may bypass this (KERNEL_CONSTITUTION.md #14).
 */
import type {
  InterruptionPolicy,
  JarvisMode,
  NotificationDisposition,
  NotificationRequest,
  NotificationSeverity,
  NotificationUrgency,
} from '@jarvis/contracts';

const SEVERITY_RANK: Record<NotificationSeverity, number> = {
  info: 0,
  notice: 1,
  warning: 2,
  critical: 3,
};
const URGENCY_RANK: Record<NotificationUrgency, number> = {
  deferrable: 0,
  normal: 1,
  urgent: 2,
  immediate: 3,
};

export const DEFAULT_INTERRUPTION_POLICY: InterruptionPolicy = {
  minSeverityByMode: {
    DORMANT: 'critical',
    AMBIENT: 'critical',
    ENGAGED: 'notice',
    FOCUSED: 'warning',
    AUTONOMOUS: 'warning',
    GUARDIAN: 'warning',
    DEGRADED: 'notice',
  },
  minUrgencyWhenUserFocused: 'urgent',
  dedupeWindowMs: 60_000,
};

export interface GateContext {
  mode: JarvisMode;
  userFocused: boolean;
  /** True if an identical dedupeKey was seen within the window. */
  isDuplicate: boolean;
  /** True if no delivery surface is currently connected. */
  noSurface: boolean;
}

export interface GateDecision {
  disposition: NotificationDisposition;
  rationale: string;
}

export function decideDisposition(
  req: NotificationRequest,
  ctx: GateContext,
  policy: InterruptionPolicy = DEFAULT_INTERRUPTION_POLICY,
): GateDecision {
  if (ctx.isDuplicate) {
    return { disposition: 'suppressed', rationale: `duplicate within ${policy.dedupeWindowMs}ms window` };
  }

  // Immediate + critical always gets through (safety valve), even in DORMANT.
  if (req.severity === 'critical' && req.urgency === 'immediate') {
    return ctx.noSurface
      ? { disposition: 'queued', rationale: 'critical/immediate but no surface connected' }
      : { disposition: 'delivered', rationale: 'critical/immediate safety valve' };
  }

  const modeBar = policy.minSeverityByMode[ctx.mode];
  if (SEVERITY_RANK[req.severity] < SEVERITY_RANK[modeBar]) {
    return {
      disposition: 'batched',
      rationale: `severity ${req.severity} below ${ctx.mode} bar (${modeBar})`,
    };
  }

  if (ctx.userFocused && URGENCY_RANK[req.urgency] < URGENCY_RANK[policy.minUrgencyWhenUserFocused]) {
    return {
      disposition: 'batched',
      rationale: `user is FOCUSED; urgency ${req.urgency} below ${policy.minUrgencyWhenUserFocused}`,
    };
  }

  if (ctx.noSurface) {
    return { disposition: 'queued', rationale: 'passed the gate but no surface connected' };
  }

  return { disposition: 'delivered', rationale: 'passed interruption policy' };
}
