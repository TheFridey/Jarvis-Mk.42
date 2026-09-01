/**
 * JARVIS operating modes (ADR-0019).
 *
 * A versioned facet of authoritative state owned by the State Manager. Changed
 * only via the deterministic transition table. A posture, NEVER an authority
 * bypass: mode may strengthen a policy decision, never weaken one.
 */

import type { Timestamp } from './common.ts';

export type JarvisMode =
  | 'DORMANT'
  | 'AMBIENT'
  | 'ENGAGED'
  | 'FOCUSED'
  | 'AUTONOMOUS'
  | 'GUARDIAN'
  | 'DEGRADED';

export const JARVIS_MODES: readonly JarvisMode[] = [
  'DORMANT',
  'AMBIENT',
  'ENGAGED',
  'FOCUSED',
  'AUTONOMOUS',
  'GUARDIAN',
  'DEGRADED',
] as const;

/**
 * Legal transitions (ADR-0019). `ANY -> DEGRADED` and `ANY -> GUARDIAN` are
 * expressed by including those targets in every source's set.
 */
export const LEGAL_MODE_TRANSITIONS: Readonly<Record<JarvisMode, readonly JarvisMode[]>> = {
  DORMANT: ['AMBIENT', 'DEGRADED', 'GUARDIAN'],
  AMBIENT: ['DORMANT', 'ENGAGED', 'AUTONOMOUS', 'DEGRADED', 'GUARDIAN'],
  ENGAGED: ['AMBIENT', 'FOCUSED', 'AUTONOMOUS', 'DEGRADED', 'GUARDIAN'],
  FOCUSED: ['ENGAGED', 'AMBIENT', 'DEGRADED', 'GUARDIAN'],
  AUTONOMOUS: ['AMBIENT', 'ENGAGED', 'DEGRADED', 'GUARDIAN'],
  DEGRADED: ['AMBIENT', 'ENGAGED', 'DORMANT', 'GUARDIAN'],
  GUARDIAN: ['AMBIENT', 'DEGRADED'],
} as const;

export type ModeTransitionTrigger =
  | 'operator_request'
  | 'presence_change'
  | 'interaction_started'
  | 'interaction_ended'
  | 'focus_requested'
  | 'focus_released'
  | 'objective_activated'
  | 'dependency_unhealthy'
  | 'dependency_recovered'
  | 'security_event'
  | 'security_cleared'
  | 'idle_timeout';

export interface ModeState {
  mode: JarvisMode;
  since: Timestamp;
  /** Optimistic-concurrency version of the mode state row. */
  version: number;
  /** The trigger that produced the current mode. */
  lastTrigger: ModeTransitionTrigger;
  reason: string;
}

/** Payload of `jarvis.kernel.mode.changed`. */
export interface ModeChangedPayload {
  from: JarvisMode;
  to: JarvisMode;
  trigger: ModeTransitionTrigger;
  reason: string;
  version: number;
}

export interface ModeTransitionRequest {
  to: JarvisMode;
  trigger: ModeTransitionTrigger;
  reason: string;
  /** Optional guard evidence the transition policy will check. */
  context?: {
    presencePresent?: boolean;
    activeObjectiveCount?: number;
    criticalDepsHealthy?: boolean;
    securityCleared?: boolean;
    minDwellElapsed?: boolean;
  };
}

export type ModeTransitionDecision =
  | { allowed: true }
  | { allowed: false; code: ModeRejectionCode; detail: string };

export type ModeRejectionCode =
  | 'illegal_transition'
  | 'guard_presence'
  | 'guard_objective'
  | 'guard_health'
  | 'guard_security_clear'
  | 'guard_dwell'
  | 'same_mode';
