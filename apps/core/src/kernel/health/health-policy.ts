/**
 * Health roll-up - PURE. The overall status is the worst status among CRITICAL
 * subsystems (non-critical subsystems degrade the picture but never take the
 * system to OFFLINE on their own).
 */
import type { HealthStatus, SubsystemHealth } from '@jarvis/contracts';

const SEVERITY: Record<HealthStatus, number> = {
  HEALTHY: 0,
  STARTING: 1,
  RECOVERING: 2,
  DEGRADED: 3,
  OFFLINE: 4,
};

export function computeOverall(subsystems: SubsystemHealth[]): {
  overall: HealthStatus;
  criticalIssues: string[];
} {
  if (subsystems.length === 0) return { overall: 'STARTING', criticalIssues: [] };

  let worst: HealthStatus = 'HEALTHY';
  const criticalIssues: string[] = [];

  for (const s of subsystems) {
    if (s.critical) {
      if (SEVERITY[s.status] > SEVERITY[worst]) worst = s.status;
      if (s.status !== 'HEALTHY' && s.status !== 'RECOVERING') {
        criticalIssues.push(`${s.subsystem}: ${s.status} - ${s.message}`);
      }
    }
  }

  // Non-critical OFFLINE/DEGRADED nudges a HEALTHY system to DEGRADED, no worse.
  if (worst === 'HEALTHY' || worst === 'STARTING') {
    const nonCriticalTrouble = subsystems.some(
      (s) => !s.critical && (s.status === 'OFFLINE' || s.status === 'DEGRADED'),
    );
    if (nonCriticalTrouble) worst = 'DEGRADED';
  }

  return { overall: worst, criticalIssues };
}

/** Maps overall health to the `degradation_state` slice level. */
export function degradationLevel(overall: HealthStatus): 'nominal' | 'degraded' | 'critical' {
  if (overall === 'OFFLINE') return 'critical';
  if (overall === 'DEGRADED') return 'degraded';
  return 'nominal';
}
