/**
 * Health Manager (KERNEL_CONSTITUTION.md #15, FAILURE_MODEL.md).
 *
 * Every major subsystem registers with a criticality flag + dependency edges
 * and pushes heartbeats. The manager:
 *  - rolls up an overall status (worst critical wins)
 *  - emits `jarvis.kernel.health.transitioned` on any subsystem change
 *  - writes the `degradation_state` state slice (system actor)
 *  - notifies a listener so the Mode Manager can enter/leave DEGRADED
 *
 * "Diagnose yourself" == `report()`, built from real subsystem data.
 */
import {
  EventNames,
  type HealthHeartbeat,
  type HealthReport,
  type HealthStatus,
  type SubsystemHealth,
} from '@jarvis/contracts';
import type { Clock } from '../../runtime/clock.ts';
import type { IdGen } from '../../runtime/ids.ts';
import { Mutex } from '../../runtime/mutex.ts';
import type { EventManager } from '../event-fabric/event-manager.ts';
import type { StateManager } from '../state/state-manager.ts';
import { computeOverall, degradationLevel } from './health-policy.ts';

export interface SubsystemRegistration {
  subsystem: string;
  critical: boolean;
  dependsOn?: string[];
}

export type HealthChangeListener = (report: HealthReport) => void;

export class HealthManager {
  private readonly subsystems = new Map<string, SubsystemHealth>();
  private readonly gate = new Mutex();
  private listeners: HealthChangeListener[] = [];
  private lastOverall: HealthStatus = 'STARTING';

  constructor(
    private readonly deps: {
      state: StateManager;
      events: EventManager;
      clock: Clock;
      ids: IdGen;
    },
  ) {}

  onChange(fn: HealthChangeListener): void {
    this.listeners.push(fn);
  }

  register(reg: SubsystemRegistration): void {
    if (this.subsystems.has(reg.subsystem)) return;
    this.subsystems.set(reg.subsystem, {
      subsystem: reg.subsystem,
      status: 'STARTING',
      critical: reg.critical,
      dependsOn: reg.dependsOn ?? [],
      message: 'registered',
      updatedAt: this.deps.clock.nowIso(),
    });
  }

  heartbeat(hb: HealthHeartbeat): Promise<void> {
    return this.gate.run(() => this.applyHeartbeat(hb));
  }

  private async applyHeartbeat(hb: HealthHeartbeat): Promise<void> {
    const existing = this.subsystems.get(hb.subsystem);
    if (!existing) {
      this.subsystems.set(hb.subsystem, {
        subsystem: hb.subsystem,
        status: hb.status,
        critical: false,
        dependsOn: [],
        message: hb.message ?? '',
        updatedAt: this.deps.clock.nowIso(),
        ...(hb.detail ? { detail: hb.detail } : {}),
      });
    } else {
      if (existing.status === hb.status && existing.message === (hb.message ?? existing.message)) {
        existing.updatedAt = this.deps.clock.nowIso();
        if (hb.detail) existing.detail = hb.detail;
        return;
      }
    }

    const before = existing?.status ?? 'STARTING';
    const overallBefore = this.rollup().overall;

    const updated: SubsystemHealth = {
      subsystem: hb.subsystem,
      status: hb.status,
      critical: existing?.critical ?? false,
      dependsOn: existing?.dependsOn ?? [],
      message: hb.message ?? (existing?.message ?? ''),
      updatedAt: this.deps.clock.nowIso(),
      ...(hb.detail ? { detail: hb.detail } : {}),
    };
    this.subsystems.set(hb.subsystem, updated);

    const { overall, criticalIssues } = this.rollup();

    await this.deps.events
      .emit({
        type: EventNames.HealthTransitioned,
        retentionClass: 'OPERATIONAL',
        privacyClass: 'INTERNAL',
        subject: { kind: 'subsystem', id: hb.subsystem },
        actor: { kind: 'system', id: 'health-manager' },
        correlationId: this.deps.ids.ulid(),
        causationId: 'none',
        principalId: 'system',
        payload: {
          subsystem: hb.subsystem,
          from: before,
          to: hb.status,
          message: updated.message,
          overallBefore,
          overallAfter: overall,
        },
      })
      .catch(() => undefined);

    if (overall !== this.lastOverall) {
      this.lastOverall = overall;
      await this.deps.state
        .mutate({
          key: 'degradation_state',
          value: {
            level: degradationLevel(overall),
            criticalIssues,
            overallHealth: overall,
          },
          expectedVersion: -1,
          correlationId: this.deps.ids.ulid(),
          actor: { kind: 'system', id: 'health-manager' },
          reason: `overall health ${overall}`,
        })
        .catch(() => undefined);
    }

    const report = this.report();
    for (const l of this.listeners) {
      try {
        l(report);
      } catch {
        /* ignore listener errors */
      }
    }
  }

  private rollup(): { overall: HealthStatus; criticalIssues: string[] } {
    return computeOverall([...this.subsystems.values()]);
  }

  report(): HealthReport {
    const subsystems = [...this.subsystems.values()].sort((a, b) =>
      a.subsystem.localeCompare(b.subsystem),
    );
    const { overall, criticalIssues } = computeOverall(subsystems);
    return {
      overall,
      generatedAt: this.deps.clock.nowIso(),
      subsystems,
      criticalIssues,
    };
  }

  criticalDepsHealthy(): boolean {
    return [...this.subsystems.values()].every(
      (s) => !s.critical || s.status === 'HEALTHY' || s.status === 'RECOVERING',
    );
  }

  get overall(): HealthStatus {
    return this.lastOverall;
  }
}
