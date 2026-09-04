/**
 * Diagnostics service - the structured answer behind "I am operational".
 * READ-ONLY. Assembles a DiagnosticsReport from real subsystem data. Subsystems
 * not yet implemented (Model Gateway, RTC, Memory) are reported with
 * `placeholder: true` - never faked as HEALTHY (engineering rule).
 */
import type {
  DependencyState,
  DiagnosticsReport,
  HealthStatus,
  JarvisMode,
} from '@jarvis/contracts';
import type { Clock } from '../../runtime/clock.ts';
import type { EventManager } from '../event-fabric/event-manager.ts';
import type { EventStore } from '../event-fabric/event-store.ts';
import type { OutboxStore, PgDeadLetterSink } from '../event-fabric/stores.ts';
import type { HealthManager } from '../health/health-manager.ts';
import type { ModeManager } from '../mode/mode-manager.ts';
import type { SessionManager } from '../session/session-manager.ts';
import type { StateManager } from '../state/state-manager.ts';

export interface DiagnosticsDeps {
  clock: Clock;
  startedAtMs: number;
  instanceId: string;
  nodeId: string;
  version: string;
  events: EventManager;
  eventStore: EventStore;
  outbox: OutboxStore;
  deadLetter: PgDeadLetterSink;
  state: StateManager;
  sessions: SessionManager;
  health: HealthManager;
  mode: ModeManager;
  pingDb: () => Promise<boolean>;
  pingRedis: () => Promise<boolean>;
  busHealthy: () => boolean;
}

export class DiagnosticsService {
  constructor(private readonly deps: DiagnosticsDeps) {}

  async report(): Promise<DiagnosticsReport> {
    const [
      mode,
      stateView,
      sessionCounts,
      totalEvents,
      outboxPending,
      deadLettered,
      recentCount,
      dbOk,
      redisOk,
      connectedNodesSlice,
      alertsSlice,
      lastMutationAt,
      checkpointEventId,
    ] = await Promise.all([
      this.deps.mode.current(),
      this.deps.state.view(),
      this.deps.sessions.countActive(),
      this.deps.eventStore.count(),
      this.deps.outbox.pendingCount(),
      this.deps.deadLetter.count(),
      this.deps.eventStore.countSince(
        new Date(this.deps.clock.epochMs() - 60_000).toISOString(),
      ),
      this.deps.pingDb(),
      this.deps.pingRedis(),
      this.deps.state.getSlice('connected_nodes'),
      this.deps.state.getSlice('active_alerts'),
      Promise.resolve(this.deps.state.lastMutationTime),
      this.deps.state.checkpointEventId(),
    ]);

    const nodeIds = (connectedNodesSlice?.value as { nodeIds: string[] } | undefined)?.nodeIds ?? [];
    const alertIds = (alertsSlice?.value as { alertIds: string[] } | undefined)?.alertIds ?? [];
    const healthReport = this.deps.health.report();

    const dependencies: DependencyState[] = [
      { name: 'postgres', status: dbOk ? 'HEALTHY' : 'OFFLINE', placeholder: false },
      { name: 'redis', status: redisOk ? 'HEALTHY' : 'OFFLINE', placeholder: false },
      {
        name: 'event-bus',
        status: this.deps.busHealthy() ? 'HEALTHY' : 'DEGRADED',
        placeholder: false,
        detail: { pendingOutbox: outboxPending },
      },
      {
        name: 'nats',
        status: healthReport.subsystems.find((item) => item.subsystem === 'nats')?.status ?? 'OFFLINE',
        placeholder: false,
      },
      { name: 'model-gateway', status: 'OFFLINE' as HealthStatus, placeholder: true },
      { name: 'rtc', status: 'OFFLINE' as HealthStatus, placeholder: true },
      { name: 'memory-subsystem', status: 'OFFLINE' as HealthStatus, placeholder: true },
    ];

    const ok =
      dbOk &&
      healthReport.overall !== 'OFFLINE' &&
      deadLettered === 0;

    return {
      ok,
      generatedAt: this.deps.clock.nowIso(),
      identity: {
        nodeId: this.deps.nodeId,
        instanceId: this.deps.instanceId,
        version: this.deps.version,
      },
      mode: mode as JarvisMode,
      uptimeSeconds: Math.floor((this.deps.clock.epochMs() - this.deps.startedAtMs) / 1000),
      events: {
        ratePerMinute: recentCount,
        totalAppended: totalEvents,
        outboxPending,
        deadLettered,
      },
      state: {
        stateVersion: stateView.stateVersion,
        lastMutationAt,
        snapshotCheckpointEventId: checkpointEventId,
      },
      sessions: { active: sessionCounts.total, byType: sessionCounts.byType },
      objectives: { active: 0, placeholder: true },
      nodes: { connected: nodeIds.length, ids: nodeIds },
      dependencies,
      health: healthReport,
      alerts: {
        active: alertIds.length,
        items: alertIds.slice(-10).map((id) => ({
          id,
          severity: 'unknown',
          title: 'alert',
          since: this.deps.clock.nowIso(),
        })),
      },
    };
  }
}
