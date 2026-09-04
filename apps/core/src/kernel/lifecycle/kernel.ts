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
  type Capability,
  type Grant,
  type JarvisMode,
} from '@jarvis/contracts';
import { BASE_RULE_PACK, evaluatePolicy } from '@jarvis/permissions';
import type { AdapterHost } from '@jarvis/adapter-host';
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
import { CapabilityRegistry, PgCapabilityStore } from '../capability-registry/index.ts';
import { AgencyAuthorizer, ApprovalManager, PgTokenCache, PermissionManager, PgGrantStore } from '../permission/index.ts';
import { AgencyRecovery, CapabilityExecutor, createAdapterHost, HostedAdapterRunner, HostedVerificationWorld, KernelExecutorEventSink, PgInvocationStore, PgResourceLeaseManager, VerificationRunner } from '../executor/index.ts';
import { CredentialBroker, MemoryCredentialMaterialStore } from '../credential-broker/index.ts';
import { AgencyIngress } from '../agency-ingress/index.ts';
import { SentinelDetectorService } from '../sentinel/index.ts';
import { validateJsonSchema } from '../agency-ingress/json-schema.ts';

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
  capabilities?: Array<{ manifest: Capability; moduleUrl: string; artifactHash?: string }>;
  bootstrapGrants?: Grant[];
  credentialMaterial?: Record<string, string>;
  adapterHost?: AdapterHost;
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
  readonly capabilityRegistry: CapabilityRegistry;
  readonly permissions: PermissionManager;
  readonly approvals: ApprovalManager;
  readonly credentialBroker: CredentialBroker;
  readonly agency: AgencyIngress;
  readonly sentinel: SentinelDetectorService;
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

  let currentPrincipalId = config.bootstrapPrincipalId;
  let presenceIsPresent = false;
  let activeObjectiveCount = 0;

  const mode = new ModeManager({
    state,
    events,
    clock,
    ids,
    minDwellMs: config.modeMinDwellMs,
    guardInputs: () => ({
      presencePresent: presenceIsPresent,
      activeObjectiveCount,
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

  const registeredCapabilities: string[] = [];
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

  const capabilityStore = new PgCapabilityStore(pg.sql);
  const capabilityRegistry = new CapabilityRegistry(capabilityStore);
  const grantStore = new PgGrantStore(pg.sql);
  const tokenCache = new PgTokenCache(pg.sql);
  const permissions = new PermissionManager(grantStore, tokenCache, () => clock.nowIso());
  const approvals = new ApprovalManager(pg.sql, () => clock.nowIso());
  const authorizer = new AgencyAuthorizer(grantStore, permissions, approvals, () => clock.nowIso());
  const credentialBroker = new CredentialBroker(new MemoryCredentialMaterialStore(ov.credentialMaterial ?? {}), tokenCache, () => clock.nowIso(), pg.sql);
  const adapterHost = ov.adapterHost ?? createAdapterHost();
  const adapterModules = new Map((ov.capabilities ?? []).map((entry) => [entry.manifest.id, entry.moduleUrl]));
  const verification = new VerificationRunner(new HostedVerificationWorld(adapterHost, adapterModules));
  const invocationStore = new PgInvocationStore(pg.sql);
  const leases = new PgResourceLeaseManager(pg.sql, config.instanceId, () => new Date(clock.nowIso()));
  const executorEvents = new KernelExecutorEventSink(events);
  const agencyRecovery = new AgencyRecovery(pg.sql, invocationStore, executorEvents, () => clock.nowIso());
  const executor = new CapabilityExecutor({
    lookup: (id, version) => capabilityRegistry.lookup(id, version),
    validateInput: validateJsonSchema,
    evaluate: async ({ capability, action, proposal, origin }) => { const principalId = origin.onBehalfOf ?? origin.id; const grant = await grantStore.findActive(principalId, capability.requiredScopes, clock.nowIso()); return evaluatePolicy({ actor: { kind: origin.kind === 'agent' ? 'agent' : 'principal', id: origin.id, onBehalfOf: principalId, heldScopes: grant?.scopes ?? [] }, action: { capabilityId: capability.id, action: action.name, riskClass: action.riskClass, requiredScopes: [...capability.requiredScopes] }, context: { operatorReachable: true, degradation: health.overall === 'HEALTHY' ? 'nominal' : 'degraded', derivedFromUntrusted: proposal.provenance.derivedFromUntrusted, hostTrustTier: 'kernel-local', now: clock.nowIso(), resourceRef: String(proposal.invocation.input), originNodeId: config.nodeId, authTrustLevel: 'verified', authMethod: 'kernel-session', jarvisMode: await mode.current(), recentDenialCount: 0 } }, BASE_RULE_PACK); },
    permission: authorizer,
    broker: credentialBroker,
    adapter: (capability) => { const moduleUrl = adapterModules.get(capability.id); if (!moduleUrl) throw new Error('adapter module unavailable'); return new HostedAdapterRunner(adapterHost, capability, moduleUrl); },
    verification,
    events: executorEvents,
    store: invocationStore,
    leases,
    now: () => clock.nowIso(),
  });
  const agency = new AgencyIngress(executor);
  const sentinel = new SentinelDetectorService();

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
    if (cur === 'DEGRADED' && health.criticalDepsHealthy()) {
      await mode.requestTransition('AMBIENT', 'dependency_recovered', 'critical dependencies healthy');
    } else if (
      (overall === 'OFFLINE' || overall === 'DEGRADED') &&
      cur !== 'DEGRADED' &&
      cur !== 'GUARDIAN'
    ) {
      await mode.requestTransition('DEGRADED', 'dependency_unhealthy', `overall health ${overall}`);
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
    capabilityRegistry,
    permissions,
    approvals,
    credentialBroker,
    agency,
    sentinel,
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
      health.register({ subsystem: 'agency', critical: true, dependsOn: ['postgres'] });
      health.register({ subsystem: 'adapter-host', critical: true, dependsOn: ['agency'] });

      // 1. PostgreSQL
      const dbOk = await pg.ping();
      await health.heartbeat({ subsystem: 'postgres', status: dbOk ? 'HEALTHY' : 'OFFLINE', message: dbOk ? 'connected' : 'unreachable' });
      if (ov.autoMigrate && dbOk) {
        await runMigrations(pg.sql);
      }

      for (const entry of ov.capabilities ?? []) {
        const registered = await capabilityRegistry.register(entry.manifest, entry.artifactHash ?? 'local-module', 'kernel-bootstrap');
        if (!registered.ok) throw new Error(`capability registration failed: ${registered.code}`);
        registeredCapabilities.push(entry.manifest.id);
        await events.emit({ type: EventNames.CapabilityRegistered, retentionClass: 'AUDIT', privacyClass: 'INTERNAL', subject: { kind: 'capability', id: entry.manifest.id }, actor: { kind: 'system', id: 'capability-registry' }, correlationId: ids.ulid(), causationId: 'kernel-start', principalId: 'system', payload: { capabilityId: entry.manifest.id, version: entry.manifest.version, registeredBy: 'kernel-bootstrap', artifactHash: entry.artifactHash ?? 'local-module' } });
      }
      for (const grant of ov.bootstrapGrants ?? []) { await permissions.issueGrant(grant); await events.emit({ type: EventNames.GrantIssued, retentionClass: 'SECURITY', privacyClass: 'SENSITIVE', subject: { kind: 'grant', id: grant.id }, actor: { kind: 'system', id: 'permission-manager' }, correlationId: ids.ulid(), causationId: 'kernel-start', principalId: grant.principalId, payload: { grantId: grant.id, principalId: grant.principalId, version: grant.version, scopes: grant.scopes } }); }

      // 2. State
      await state.init();
      await this.catchUpState();
      const objective = await state.getSlice('active_objective');
      activeObjectiveCount = objective && Object.values(objective.value as Record<string, unknown>).some((value) => value != null && value !== '') ? 1 : 0;
      state.subscribe(['active_objective'], (update) => { activeObjectiveCount = Object.values(update.slice.value as Record<string, unknown>).some((value) => value != null && value !== '') ? 1 : 0; });
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
      await agencyRecovery.recoverExpiredLeases();
      await health.heartbeat({ subsystem: 'agency', status: 'HEALTHY', message: `${registeredCapabilities.length} registered capabilities` });
      await health.heartbeat({ subsystem: 'adapter-host', status: 'HEALTHY', message: 'isolated worker host ready' });

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
        return reconcileModeWithHealth(report.overall);
      });
    },

    async stop() {
      if (!started) return;
      started = false;
      agency.stop();
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
