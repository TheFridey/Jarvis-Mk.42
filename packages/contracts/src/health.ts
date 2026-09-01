/**
 * Health Manager contracts.
 *
 * Governance: docs/architecture/KERNEL_CONSTITUTION.md sec 1 (#15),
 *             docs/architecture/FAILURE_MODEL.md.
 *
 * Every major subsystem advertises a status + its dependency edges. The Health
 * Manager aggregates these into a system picture and drives DEGRADED mode.
 */

import type { Timestamp } from './common.ts';

export type HealthStatus =
  | 'STARTING'
  | 'HEALTHY'
  | 'DEGRADED'
  | 'OFFLINE'
  | 'RECOVERING';

export interface SubsystemHealth {
  /** Stable subsystem id, e.g. "event-fabric", "state-manager", "postgres". */
  subsystem: string;
  status: HealthStatus;
  /** Whether this subsystem is required for the Kernel's core loop. */
  critical: boolean;
  /** Subsystem ids this one depends on. */
  dependsOn: string[];
  message: string;
  updatedAt: Timestamp;
  /** Free-form structured detail (latency, queue depth, last error). */
  detail?: Record<string, unknown>;
}

export interface HealthReport {
  /** Rolled-up system status: worst critical subsystem wins. */
  overall: HealthStatus;
  generatedAt: Timestamp;
  subsystems: SubsystemHealth[];
  /** Critical subsystems not HEALTHY/RECOVERING - the reason for any DEGRADED. */
  criticalIssues: string[];
}

/** Payload of `jarvis.kernel.health.transitioned`. */
export interface HealthTransitionedPayload {
  subsystem: string;
  from: HealthStatus;
  to: HealthStatus;
  message: string;
  overallBefore: HealthStatus;
  overallAfter: HealthStatus;
}

/** A subsystem pushes this to the Health Manager. */
export interface HealthHeartbeat {
  subsystem: string;
  status: HealthStatus;
  message?: string;
  detail?: Record<string, unknown>;
}
