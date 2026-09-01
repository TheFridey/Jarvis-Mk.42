/**
 * The JARVIS Kernel composition root (KERNEL_CONSTITUTION.md).
 *
 * MK.43 DEVIATION from ADR-0001: this is a plain module, not a NestJS
 * application. The NestJS dependency tree could not be installed in this
 * environment (external drive; pathological pnpm link times). Every component
 * is still a bounded unit with constructor injection and an interface; wiring
 * it into NestJS modules later is mechanical. Tracked in the MK43 notes.
 *
 * Cold start (KERNEL_CONSTITUTION.md sec 5):
 *   connect PG -> (migrate) -> ensure state rows -> catch state up from events
 *   -> connect Redis (best-effort) -> connect bus -> start outbox relay
 *   -> register health -> start scheduler routines -> ensure bootstrap identity
 *   -> start diagnostics HTTP -> emit operational -> DORMANT->AMBIENT
 *
 * The core decision loop (accept mutation -> validate -> persist) is available
 * after the PG + state steps even if the bus / Redis are down (L39).
 */
import {
  EventNames,
  type JarvisMode,
} from '@jarvis/contracts';
import { createPg, runMigrations, type PgHandle } from '@jarvis/persistence';
import { startTelemetry, stopTelemetry } from '@jarvis/telemetry';

import type { KernelConfig } from '../../runtime/config.ts';
import { SystemClock, type Clock } from '../../runtime/clock.ts';
import { UlidGen, type IdGen } from '../../runtime/ids.ts';
import { PgTxRunner } from '../../runtime/tx.ts';

import {
  EventManager,
  EventStore,
  InProcessEventBus,
  NatsEventBus,
  OutboxRelay,
  OutboxStore,
  PgDeadLetterSink,
  PgProcessedLedger,
  ReplayBus,
  ReplayEngine,
  RetentionSweeper,
  type EventBus,
} from '../event-fabric/index.ts';
import { StateManager, StateStore, StateProjector } from '../state/index.ts';
import { ModeManager } from '../mode/index.ts';
import { IdentityManager, IdentityStore } from '../identity/index.ts';
import { SessionManager, SessionStore } from '../session/index.ts';
import { PresenceManager } from '../presence/index.ts';
import { HealthManager } from '../health/index.ts';
import { Scheduler } from '../scheduler/index.ts';
import { NotificationManager } from '../notification/index.ts';
import { ContextCompiler } from '../context/index.ts';
import { DiagnosticsHttp, DiagnosticsService } from '../diagnostics/index.ts';

import { RedisEphemeralStore, NullEphemeralStore, type EphemeralStore } from './ephemeral.ts';
import { ROUTINE_DEFS } from './routines.ts';

export interface KernelOverrides {
  clock?: Clock;
  ids?: IdGen;
  /** Provide an already-created PG handle (tests share one). */
  pg?: PgHandle;
  /** Force the in-process bus regardless of config. */
  forceInProcessBus?: boolean;
  /** Run migrations on start (tests / fresh containers). */
  autoMigrate?: boolean;
  /** Skip binding the diagnostics HTTP port. */
  noHttp?: boolean;
  /** Skip starting the scheduler tick loop (tests drive ticks manually). */
  noScheduler?: boolean;
}

export interface KernelHandle {
  readonly config: KernelConfig;
  readonly clock: Clock;
  readonly ids: IdGen;
  readonly events: EventManager;
  readonly eventStore: EventStore;
  readonly bus: EventBus;
  readonly outboxRelay: OutboxRelay;
  readonly replay: ReplayEngine;
  readonly state: StateManager;
  readonly mode: ModeManager;
  readonly identity: IdentityManager;
  readonly sessions: SessionManager;
  readonly presence: PresenceManager;
  readonly health: HealthManager;
  readonly scheduler: Scheduler;
  readonly notifications: NotificationManager;
  readonly context: ContextCompiler;
  readonly diagnostics: DiagnosticsService;
  readonly ephemeral: EphemeralStore;
  readonly pg: PgHandle;
  diagnosticsPort: number | null;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Reset slice rows and re-fold every state.mutated event (recovery drill). */
  rebuildStateFromEvents(): Promise<{ replayed: number }>;
  /** Fold state.mutated events after the checkpoint (cold-start catch-up). */
  catchUpState(): Promise<{ replayed: number }>;
}

export function buildKernel(config: KernelConfig, ov: KernelOverrides = {}): KernelHandle {
  const clock = ov.clock ?? new SystemClock();
  const ids = ov.ids ?? new UlidGen();
  const startedAtMs = clock.epochMs();

  const pg = ov.pg ?? createPg({ url: config.dbUrl });
  const tx = new PgTxRunner(pg.sql);

  const eventStore = new EventStore(pg.sql);
  const outbox = new OutboxStore(pg.sql);
  const processed = new PgProcessedLedger(pg.sql);
  const deadLetter = new PgDeadLetterSink(pg.sql);

  const useInProc = ov.forceInProcessBus || !config.natsEnabled;
  const bus: EventBus = useInProc
    ? new InProcessEventBus(processed, deadLetter)
    : new NatsEventBus(config.natsUrl, processed, deadLetter);

  const events = new EventManager({
    sql: pg.sql,
    tx,
    store: eventStore,
    outbox,
    bus,
    clock,
    ids,
    component: 'kernel',
    nodeId: config.nodeId,
  });

  const replayBus = new ReplayBus();
  const replay = new ReplayEngine(eventStore, replayBus);

  const stateStore = new StateStore(pg.sql);
  const state = new StateManager({ sql: pg.sql, tx, store: stateStore, events });
  const stateProjector = new StateProjector(pg.sql);
  replayBus.registerProjector('state', (e) => stateProjector.apply(e));

  const health = new HealthManager({ state, events, clock, ids });

  const mode = new ModeManager({
    state,
    events,
    clock,
    ids,
    minDwellMs: config.modeMinDwellMs,
    guardInputs: () => ({
      presencePresent: presenceIsPresent,
      activeObjectiveCount: 0,
      criticalDepsHealthy: health.criticalDepsHealthy(),
    }),
  });

  const identity = new IdentityManager({
    store: new IdentityStore(pg.sql),
    events,
    clock,
    ids,
  });

  const sessions = new SessionManager({
    store: new SessionStore(pg.sql),
    events,
    tx,
    clock,
    ids,
  });

  let currentPrincipalId = config.bootstrapPrincipalId;
  let presenceIsPresent = false;

  const presence = new PresenceManager({
    state,
    events,
    clock,
    ids,
    principalId: () => currentPrincipalId,
  });

  const notifications = new NotificationManager({
    state,
    events,
    clock,
    ids,
    currentMode: () => mode.current(),
    currentPresence: async () => {
      const s = await state.getSlice('presence');
      return (s?.value as { state: 'UNKNOWN' | 'ABSENT' | 'PRESENT' | 'ENGAGED' | 'FOCUSED' }).state;
    },
  });

  const registeredCapabilities: string[] = []; // populated by a later phase
  const context = new ContextCompiler({
    state,
    eventStore,
    events,
    clock,
    ids,
    availableCapabilities: () => [...registeredCapabilities],
  });

  const ephemeral: EphemeralStore =
    config.redisUrl && !ov.forceInProcessBus
      ? new RedisEphemeralStore(config.redisUrl)
      : new NullEphemeralStore();

  const outboxRelay = new OutboxRelay(
    {
      store: eventStore,
      outbox,
      bus,
      deadLetter,
      events,
      clock,
      onHealth: (status, detail) => {
        void health.heartbeat({ subsystem: 'event-fabric', status: status === 'HEALTHY' ? 'HEALTHY' : 'DEGRADED', message: detail });
      },
    },
    {
      pollMs: config.outboxPollMs,
      batchSize: 128,
      maxAttempts: config.outboxMaxAttempts,
      baseBackoffMs: 250,
    },
  );

  const retentionSweeper = new RetentionSweeper(pg.sql, clock);

  const diagnostics = new DiagnosticsService({
    clock,
    startedAtMs,
    instanceId: config.instanceId,
    nodeId: config.nodeId,
    version: config.version,
    events,
    eventStore,
    outbox,
    deadLetter,
    state,
    sessions,
    health,
    mode,
    pingDb: () => pg.ping(),
    pingRedis: () => ephemeral.ping(),
    busHealthy: () => bus.isHealthy(),
  });

  const diagnosticsHttp = new DiagnosticsHttp({ diagnostics, state, health });

  const scheduler = new Scheduler({
    events,
    clock,
    ids,
    isPaused: () => health.overall === 'DEGRADED' || health.overall === 'OFFLINE',
  });

  let diagnosticsPort: number | null = null;
  let started = false;

  function registerRoutines(): void {
    scheduler.register(ROUTINE_DEFS.healthSelfCheck!, async () => {
      const dbOk = await pg.ping();
      await health.heartbeat({
        subsystem: 'postgres',
        status: dbOk ? 'HEALTHY' : 'OFFLINE',
        message: dbOk ? 'ok' : 'ping failed',
      });
      await health.heartbeat({
        subsystem: 'redis',
        status: (await ephemeral.ping()) ? 'HEALTHY' : 'OFFLINE',
        message: ephemeral.connected ? 'ok' : 'down',
      });
      await health.heartbeat({
        subsystem: 'nats',
        status: bus.isHealthy() ? 'HEALTHY' : 'DEGRADED',
        message: bus.isHealthy() ? 'ok' : 'bus unhealthy',
      });
    });
    scheduler.register(ROUTINE_DEFS.stateSnapshot!, async () => {
      await stateStore.takeSnapshot(await state.checkpointEventId());
    });
    scheduler.register(ROUTINE_DEFS.retentionSweep!, async () => {
      await retentionSweeper.sweep();
    });
    scheduler.register(ROUTINE_DEFS.notificationBatchFlush!, async () => {
      await notifications.flushBatch();
    });
    scheduler.register(ROUTINE_DEFS.objectiveReeval!, async () => {
      /* placeholder: Objective Engine arrives in a later phase */
    });
  }

  async function reconcileModeWithHealth(overall: string): Promise<void> {
    const cur = await mode.current();
    if (
      (overall === 'OFFLINE' || overall === 'DEGRADED') &&
      cur !== 'DEGRADED' &&
      cur !== 'GUARDIAN'
    ) {
      await mode.requestTransition('DEGRADED', 'dependency_unhealthy', `overall health ${overall}`);
    } else if (overall === 'HEALTHY' && cur === 'DEGRADED') {
      await mode.requestTransition('AMBIENT', 'dependency_recovered', 'critical dependencies healthy');
    }
  }

  const handle: KernelHandle = {
    config,
    clock,
    ids,
    events,
    eventStore,
    bus,
    outboxRelay,
    replay,
    state,
    mode,
    identity,
    sessions,
    presence,
    health,
    scheduler,
    notifications,
    context,
    diagnostics,
    ephemeral,
    pg,
    get diagnosticsPort() {
      return diagnosticsPort;
    },
    set diagnosticsPort(v) {
      diagnosticsPort = v;
    },

    async start() {
      if (started) return;
      started = true;

      startTelemetry({
        serviceName: 'jarvis-core',
        serviceVersion: config.version,
        otlpEndpoint: config.otlpEndpoint,
        disabled: config.telemetryDisabled,
      });

      health.register({ subsystem: 'postgres', critical: true });
      health.register({ subsystem: 'event-fabric', critical: true, dependsOn: ['postgres', 'nats'] });
      health.register({ subsystem: 'state-manager', critical: true, dependsOn: ['postgres'] });
      health.register({ subsystem: 'redis', critical: false });
      health.register({ subsystem: 'nats', critical: false });
      health.register({ subsystem: 'scheduler', critical: false });
      health.register({ subsystem: 'diagnostics', critical: false });

      // 1. PostgreSQL
      const dbOk = await pg.ping();
      await health.heartbeat({ subsystem: 'postgres', status: dbOk ? 'HEALTHY' : 'OFFLINE', message: dbOk ? 'connected' : 'unreachable' });
      if (ov.autoMigrate && dbOk) {
        await runMigrations(pg.sql);
      }

      // 2. State
      await state.init();
      await this.catchUpState();
      await health.heartbeat({ subsystem: 'state-manager', status: 'HEALTHY', message: 'projections current' });

      // 3. Redis (best-effort, non-critical)
      if (ephemeral instanceof RedisEphemeralStore) await ephemeral.connect();
      await health.heartbeat({
        subsystem: 'redis',
        status: (await ephemeral.ping()) ? 'HEALTHY' : 'OFFLINE',
        message: ephemeral.connected ? 'connected' : 'unavailable (ephemeral only)',
      });

      // 4. Bus + outbox relay
      try {
        await bus.start();
        await health.heartbeat({ subsystem: 'nats', status: bus.isHealthy() ? 'HEALTHY' : 'DEGRADED', message: useInProc ? 'in-process bus' : 'jetstream' });
      } catch (err) {
        await health.heartbeat({ subsystem: 'nats', status: 'OFFLINE', message: err instanceof Error ? err.message : String(err) });
      }
      outboxRelay.start();
      await health.heartbeat({ subsystem: 'event-fabric', status: 'HEALTHY', message: 'outbox relay running' });

      // 5. Bootstrap identity
      const { principal } = await identity.ensureBootstrap({
        principalId: config.bootstrapPrincipalId,
        displayName: 'Operator',
        credential: config.bootstrapCredential,
        nodeId: config.nodeId,
      });
      currentPrincipalId = principal.id;
      await state.mutate({
        key: 'active_principal',
        value: { principalId: principal.id },
        expectedVersion: -1,
        correlationId: ids.ulid(),
        actor: { kind: 'system', id: 'identity-manager' },
        reason: 'bootstrap',
      });

      // 6. Scheduler routines
      registerRoutines();
      if (!ov.noScheduler) scheduler.start();
      await health.heartbeat({ subsystem: 'scheduler', status: 'HEALTHY', message: `${Object.keys(ROUTINE_DEFS).length} routines` });

      // 7. Diagnostics HTTP
      if (!ov.noHttp) {
        diagnosticsPort = await diagnosticsHttp.listen(config.diagnosticsPort);
      }
      await health.heartbeat({ subsystem: 'diagnostics', status: 'HEALTHY', message: diagnosticsPort ? `:${diagnosticsPort}` : 'disabled' });

      // 8. Emit operational + posture DORMANT -> AMBIENT
      await events.emit({
        type: EventNames.KernelOperational,
        retentionClass: 'OPERATIONAL',
        privacyClass: 'INTERNAL',
        subject: { kind: 'kernel', id: config.instanceId },
        actor: { kind: 'system', id: 'kernel' },
        correlationId: ids.ulid(),
        causationId: 'none',
        principalId: 'system',
        payload: {
          instanceId: config.instanceId,
          coldStartMs: clock.epochMs() - startedAtMs,
          replayedEvents: 0,
        },
      });
      await mode.requestTransition('AMBIENT', 'operator_request', 'kernel operational');

      // Wire ongoing health -> mode (DEGRADED / recovery).
      health.onChange((report) => {
        void reconcileModeWithHealth(report.overall);
      });
    },

    async stop() {
      if (!started) return;
      started = false;
      await events
        .emit({
          type: EventNames.KernelStopping,
          retentionClass: 'OPERATIONAL',
          privacyClass: 'INTERNAL',
          subject: { kind: 'kernel', id: config.instanceId },
          actor: { kind: 'system', id: 'kernel' },
          correlationId: ids.ulid(),
          causationId: 'none',
          principalId: 'system',
          payload: { instanceId: config.instanceId, reason: 'shutdown' },
        })
        .catch(() => undefined);

      state.beginShutdown();
      await scheduler.stop();
      await outboxRelay.stop(); // final flush
      await stateStore.takeSnapshot(await state.checkpointEventId());
      await diagnosticsHttp.close();
      await bus.close();
      await ephemeral.close();
      await stopTelemetry();
      if (!ov.pg) await pg.close();
    },

    async rebuildStateFromEvents() {
      // Hard reset the read model to initial values, then re-fold every
      // state.mutated event through the pure projector via the ReplayBus.
      await pg.sql`delete from projections.state_slices`;
      await pg.sql`update projections.state_meta set state_version = 0, checkpoint_event_id = null where id = 1`;
      await stateStore.ensureInitialised();
      stateProjector.stats.applied = 0;
      stateProjector.stats.skippedDuplicate = 0;
      stateProjector.stats.gaps = 0;
      const res = await replay.replayAll('0');
      return { replayed: res.replayed };
    },

    async catchUpState() {
      const checkpoint = await state.checkpointEventId();
      let fromSeq = '0';
      if (checkpoint) {
        const cp = await eventStore.byId(checkpoint);
        if (cp) fromSeq = cp.globalSeq;
      }
      // Only fold state.mutated events (the state read-model's subject stream).
      let cursor = fromSeq;
      let replayed = 0;
      for (;;) {
        const page = await eventStore.readFrom(cursor, 500, EventNames.StateMutated);
        if (page.length === 0) break;
        for (const e of page) {
          await stateProjector.apply({ ...e, meta: { ...(e.meta ?? {}), replay: 'true' } });
          cursor = e.globalSeq;
          replayed++;
        }
        if (page.length < 500) break;
      }
      return { replayed };
    },

  };

  return handle;
}

/** Convenience for main.ts. */
export type { JarvisMode };
