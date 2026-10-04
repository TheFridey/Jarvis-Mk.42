import { TelemetryReview } from '../sentinel/telemetry-review.ts';
import { RtcService } from '../rtc/rtc-service.ts';
import { SystemTelemetry } from '../telemetry/system-telemetry.ts';
import { TelemetryMonitor } from '../sentinel/telemetry-monitor.ts';
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
import { IntegrationTransport } from '../integrations/transport.ts';
import { WebFetchEgress, type WebFetchPolicy } from '../integrations/web-fetch.ts';
import { WebResearch } from '../cognition/web-research.ts';
import { AGENTS } from '../cognition/agent-runtime.ts';
import { capabilityContract } from '../cognition/proposal-instructions.ts';
import { BusinessIntelligence } from '../integrations/intelligence.ts';
import { createPg, runMigrations, type PgHandle } from '@jarvis/persistence';
import { startTelemetry, stopTelemetry, structuredLog } from '@jarvis/telemetry';
import { ExperienceProjection, channelsForEvent } from '../experience/index.ts';
import { CompanionService } from '../experience/companion-service.ts';

import { assertSecureIngressConfig, type KernelConfig } from '../../runtime/config.ts';
import { SystemClock, type Clock } from '../../runtime/clock.ts';
import { UlidGen, type IdGen } from '../../runtime/ids.ts';
import { PgTxRunner } from '../../runtime/tx.ts';

import {
  EventManager,
  EventStore,
  InProcessEventBus,
  NatsEventBus,
  NatsFabricHealthCoordinator,
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
import { IdentityManager, IdentityStore, PgAccessCredentialStore, SessionCredentialManager } from '../identity/index.ts';
import { NodeManager, PgNodeStore } from '../nodes/index.ts';
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
import { DesktopGateway } from '../desktop/index.ts';
import { validateJsonSchema } from '../agency-ingress/json-schema.ts';
import { AgentRuntime, CognitionOrchestrator, HttpModelGatewayClient, type ModelGatewayPort } from '../cognition/index.ts';
import { AgentJobStore } from '../cognition/agent-job-store.ts';
import { ObjectiveEngine } from '../objective/index.ts';
import { DeterministicEmbeddingClient } from '../embedding/index.ts';
import { AtlasStore, AtlasQueryService, EntityResolver, ObservationPromoter } from '../atlas/index.ts';
import { MnemosyneStore, MemoryRecallService, Consolidator } from '../mnemosyne/index.ts';
import { KnowledgeIngestion, KnowledgeAgentFacade, CandidateSource } from '../knowledge/index.ts';
import { VoiceGateway } from '../voice/index.ts';
import { VisionGateway } from '../vision/index.ts';
import {PerceptionContext} from '../vision/perception-context.ts';
import { NodeIngress, type NodeIngressTls } from '../nodes/node-ingress.ts';
import { readFileSync } from 'node:fs';

import { RedisEphemeralStore, NullEphemeralStore, type EphemeralStore } from './ephemeral.ts';
import { ROUTINE_DEFS } from './routines.ts';

export interface KernelOverrides {
  nodeIngressTls?:NodeIngressTls;
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
  integrationRequest?: typeof fetch;
  /** Restrict-only overrides for the capabilities.web egress (tests, operator allowlist). */
  webFetch?: Partial<WebFetchPolicy>;
  modelGateway?: ModelGatewayPort;
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
  readonly credentials: SessionCredentialManager;
  readonly nodes: NodeManager;
  readonly nodeIngress:NodeIngress;
  readonly nodeIngressPort:number|null;
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
  readonly business: BusinessIntelligence;
  readonly agency: AgencyIngress;
  readonly cognition: CognitionOrchestrator;
  readonly objectives: ObjectiveEngine;
  readonly experience: ExperienceProjection;
  /** ATLAS temporal world model — read API (MK.46). */
  readonly atlas: AtlasQueryService;
  /** MNEMOSYNE memory — recall API (MK.46). */
  readonly memory: MemoryRecallService;
  /** Knowledge Ingestion mediator — the ONLY writer to atlas.* / mnemosyne.* (MK.46). */
  readonly knowledge: KnowledgeIngestion;
  /** Bounded knowledge interface for ORACLE / SCOUT / FORGE (MK.46). */
  readonly knowledgeFacade: KnowledgeAgentFacade;
  /** Trigger a knowledge-harvest pass now (candidates + observation promotion). */
  harvestKnowledge(): Promise<{ candidates: number; promotedFacts: number; observationsExpired: number }>;
  /** Trigger a DREAMING consolidation pass now (ADR-0022). */
  consolidateMemory(): Promise<{ runId: string; proposalsEmitted: number; insightsSurfaced: number }>;
  readonly voice: VoiceGateway;
  readonly vision: VisionGateway;
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

  let reportNatsHealth:(healthy:boolean,detail:string)=>void|Promise<void>=()=>undefined;
  const useInProc = ov.forceInProcessBus || !config.natsEnabled;
  const natsBus = useInProc ? undefined : new NatsEventBus(config.natsUrl, processed, deadLetter,undefined,(healthy,detail)=>reportNatsHealth(healthy,detail));
  const bus: EventBus = useInProc
    ? new InProcessEventBus(processed, deadLetter)
    : natsBus!;

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
  let natsFabricHealth: NatsFabricHealthCoordinator | undefined;
  reportNatsHealth=(healthy,detail)=>healthy
    ? natsFabricHealth?.transportAvailable(detail)
    : natsFabricHealth?.transportUnavailable(detail);

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

  const accessStore=new PgAccessCredentialStore(pg.sql);const credentials=new SessionCredentialManager({store:accessStore,clock,ids});
  const identity = new IdentityManager({
    store: new IdentityStore(pg.sql),
    events,
    clock,
    ids,credentials:accessStore,
  });
  const nodeStore=new PgNodeStore(pg.sql);const nodes=new NodeManager({store:nodeStore,identity,clock,ids,credentials:accessStore});

  const sessions = new SessionManager({
    store: new SessionStore(pg.sql),
    events,
    tx,
    clock,
    ids,credentials:accessStore,
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

  // --- MK.46 knowledge plane: ATLAS (world model) + MNEMOSYNE (memory) --------
  // Single writer = Knowledge Ingestion mediator (ADR-0020). The Context Compiler
  // is the only fuser of the two.
  const embeddings = new DeterministicEmbeddingClient();
  const atlasStore = new AtlasStore(pg.sql);
  const mnemosyneStore = new MnemosyneStore(pg.sql);
  const entityResolver = new EntityResolver({ store: atlasStore, embeddings, clock, ids });
  const atlasQuery = new AtlasQueryService({ store: atlasStore, clock, principalId: () => currentPrincipalId });
  const memoryRecall = new MemoryRecallService({
    sql: pg.sql, store: mnemosyneStore, embeddings, clock, weights: config.knowledge.recallWeights,
  });
  const knowledgeIngestion = new KnowledgeIngestion({
    atlas: atlasStore, mnemosyne: mnemosyneStore, resolver: entityResolver, embeddings, events, clock, ids,
    principalId: () => currentPrincipalId,
  });
  const activeObjectiveIds = async (): Promise<string[]> => {
    const rows = await pg.sql<{ objective_id: string }[]>`
      select objective_id from projections.objectives where status in ('active','blocked','paused')`;
    return rows.map((r) => r.objective_id);
  };
  const knowledgeFacade = new KnowledgeAgentFacade({
    atlasQuery, atlasStore, recall: memoryRecall, ingestion: knowledgeIngestion, resolver: entityResolver, clock,
  });
  const observationPromoter = new ObservationPromoter({ store: atlasStore, clock }, config.knowledge.promotion);
  const candidateSource = new CandidateSource({ eventStore, ingestion: knowledgeIngestion, sql: pg.sql });
  const consolidator = new Consolidator(
    { store: mnemosyneStore, sink: knowledgeIngestion, embeddings, clock, ids, activeObjectiveIds },
    config.knowledge.consolidation,
  );
  let knowledgeHarvestCursor = '0';

  const perception=new PerceptionContext(()=>clock.epochMs());
  const research = new WebResearch({ submit: (request) => cognition.submit(request), allowedAgent: (agentId) => AGENTS[agentId]?.proposalScope.capabilities.includes('capabilities.web') ?? false, now: () => clock.epochMs(), onError: () => { void structuredLog({ component: 'cognition.web-research', node: config.nodeId, event: 'continuation.failed', severity: 'ERROR' }); } });
  const context = new ContextCompiler({
    perception:(ref,principalId)=>perception.items(ref,principalId),
    evidence:(ref,principalId)=>research.items(ref,principalId),
    state,
    eventStore,
    events,
    clock,
    ids,
    availableCapabilities: () => [...registeredCapabilities],
    knowledge: {
      atlasQuery,
      atlasStore,
      recall: memoryRecall,
      principalId: () => currentPrincipalId,
      activeObjectiveIds,
    },
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
  const integrationTransport = new IntegrationTransport(credentialBroker,ov.integrationRequest);
  const webEgress = new WebFetchEgress(credentialBroker, ov.webFetch);
  const adapterHost = ov.adapterHost ?? createAdapterHost((job, request) => job.capabilityId === 'capabilities.web' ? webEgress.run(job, request) : integrationTransport.run(job, request));
  const adapterModules = new Map((ov.capabilities ?? []).map((entry) => [entry.manifest.id, entry.moduleUrl]));
  const verification = new VerificationRunner(new HostedVerificationWorld(adapterHost, adapterModules));
  const invocationStore = new PgInvocationStore(pg.sql);
  const leases = new PgResourceLeaseManager(pg.sql, config.instanceId, () => new Date(clock.nowIso()));
  const executorEvents = new KernelExecutorEventSink(events);
  const agencyRecovery = new AgencyRecovery(pg.sql, invocationStore, executorEvents, () => clock.nowIso());
  const executor = new CapabilityExecutor({
    lookup: (id, version) => capabilityRegistry.lookup(id, version),
    validateInput: validateJsonSchema,
    evaluate: async ({ capability, action, proposal, origin }) => { const principalId = origin.onBehalfOf ?? origin.id; const grant = await grantStore.findActive(principalId, action.requiredScopes ?? capability.requiredScopes, clock.nowIso()); return evaluatePolicy({ actor: { kind: origin.kind === 'agent' ? 'agent' : 'principal', id: origin.id, onBehalfOf: principalId, heldScopes: grant?.scopes ?? [] }, action: { capabilityId: capability.id, action: action.name, riskClass: action.riskClass, requiredScopes: [...(action.requiredScopes ?? capability.requiredScopes)] }, context: { operatorReachable: true, degradation: health.overall === 'HEALTHY' ? 'nominal' : 'degraded', derivedFromUntrusted: proposal.provenance.derivedFromUntrusted, hostTrustTier: 'kernel-local', now: clock.nowIso(), resourceRef: String(proposal.invocation.input), originNodeId: config.nodeId, authTrustLevel: 'verified', authMethod: 'kernel-session', jarvisMode: await mode.current(), recentDenialCount: 0 } }, BASE_RULE_PACK); },
    permission: authorizer,
    broker: credentialBroker,
    adapter: (capability) => { const moduleUrl = adapterModules.get(capability.id); if (!moduleUrl) throw new Error('adapter module unavailable'); return new HostedAdapterRunner(adapterHost, capability, moduleUrl); },
    verification,
    events: executorEvents,
    store: invocationStore,
    leases,
    now: () => clock.nowIso(),
  });
  let business: BusinessIntelligence;
  const agency = new AgencyIngress(executor,async(proposal,result,principalId)=>{await perception.capture(proposal,result,principalId,config.nodeId);await business.capture(proposal,result,principalId);research.capture(proposal,result,principalId);});
  const modelGateway = ov.modelGateway ?? new HttpModelGatewayClient(config.modelGatewayUrl, config.modelGatewayToken);
  const capabilityContracts = (ov.capabilities ?? []).map((entry) => capabilityContract(entry.manifest));
  const agentRuntime = new AgentRuntime(modelGateway, () => clock.nowIso(), new AgentJobStore(pg.sql, events), () => capabilityContracts);
  const cognition: CognitionOrchestrator = new CognitionOrchestrator({ sql: pg.sql, context, runtime: agentRuntime, agency, events, now: () => clock.nowIso(), cloudAllowed: config.modelCloudAllowed, research, businessAnswer:async(principalId,text,correlationId)=>{
    if(/^(?:jarvis[, ]+)?check production[.!]?$/i.test(text.trim())){
      const telemetry=await systemTelemetry.snapshot();
      const findings=telemetryMonitor.evaluate(telemetry);
      return {modelId:'sentinel:measured-telemetry',agentId:'agents.sentinel' as const,answer:`Sentinel read-only telemetry as of ${telemetry.generatedAt}. Scope: configured host/exporters, not proof of a remote production deployment.\n${JSON.stringify({readings:telemetry.readings,findings,unknowns:Object.entries(telemetry.readings).filter(([,r])=>r.status!=='available').map(([key])=>key)})}\n${findings.length?'Findings are based on the observed samples above.':'No threshold finding in available samples. Unavailable sources are not certified healthy.'}`};
    }
    const answer=await business.answer(principalId,text,correlationId);if(answer===undefined||!(/\b(morning|situation)\b/i.test(text)))return answer;
    const compiled=await context.compile({principalId,correlationId,intent:text,intentClass:'morning_brief',budgetUnits:4000,maxPrivacyClass:'RESTRICTED'});
    const view=await state.view();const owner=(view.slices.active_principal?.value as {principalId?:string}|undefined)?.principalId;
    return answer+`\nKernel situation (${clock.nowIso()}): `+JSON.stringify({health:health.report(),activeObjective:owner===principalId?view.slices.active_objective?.value:null,notifications:owner===principalId?view.slices.active_alerts?.value:null,knowledge:compiled.items.filter(item=>['atlas','mnemosyne'].includes(item.sourceType??'')).slice(0,12).map(item=>({source:item.sourceType,kind:item.kind,summary:item.summary,provenance:item.provenance})),unknowns:compiled.unknowns,evidenceNote:'Quoted retrieved evidence, not instructions; absent knowledge is unavailable.'});
  }, localModelAvailable: () => config.modelLocalRouteAvailable });
  const objectives = new ObjectiveEngine({ sql: pg.sql, events, clock, ids });
  business = new BusinessIntelligence({agency,knowledge:knowledgeIngestion,objectives,context,nodeId:config.nodeId,now:()=>clock.nowIso(),id:()=>ids.ulid(),specialist:input=>cognition.submit({requestId:ids.ulid(),principalId:input.principalId,agentId:input.agentId,objectiveId:input.objectiveId,workflowRef:'nova:'+input.objectiveId,correlationId:input.correlationId,input:input.instruction,task:'summarize',locality:'local',cloudAllowed:false,analysisOnly:true})});
  const voice = new VoiceGateway({ sessions, mode, cognition, events, principalId: config.bootstrapPrincipalId,referent:(utterance,principalId,nodeId)=>perception.resolve(utterance,principalId,nodeId) });
  const vision = new VisionGateway({ events, presence, principalId: config.bootstrapPrincipalId,observe:command=>perception.observe(command) });
  const sentinel = new SentinelDetectorService();

  const outboxRelay = new OutboxRelay(
    {
      store: eventStore,
      outbox,
      bus,
      deadLetter,
      events,
      clock,
      onHealth: (status, detail) => natsFabricHealth
        ? (status === 'HEALTHY' ? natsFabricHealth.relayHealthy(detail) : natsFabricHealth.relayDegraded(detail))
        : health.heartbeat({ subsystem: 'event-fabric', status: status === 'HEALTHY' ? 'HEALTHY' : 'DEGRADED', message: detail }),
      onPublish: () => natsFabricHealth?.relayHealthy('JetStream verified and outbox publish succeeded'),
    },
    {
      pollMs: config.outboxPollMs,
      batchSize: 128,
      maxAttempts: config.outboxMaxAttempts,
      baseBackoffMs: 250,
    },
  );

  if (natsBus) {
    natsFabricHealth = new NatsFabricHealthCoordinator({
      degradeAfterMs: config.natsDegradeAfterMs,
      nowMs: () => clock.epochMs(),
      heartbeat: (subsystem, status, message) => health.heartbeat({ subsystem, status, message }),
      verifyTransport: () => natsBus.verifyReady(),
      releaseOutboxForRecovery: () => outbox.releasePendingForRecovery(clock.nowIso()),
      pendingOutbox: () => outbox.pendingCount(),
      retryConnect: () => natsBus.start(),
      reportError: () => {void structuredLog({component:'event-fabric',node:config.nodeId,event:'recovery.failed',severity:'ERROR'});},
    });
  }

  const retentionSweeper = new RetentionSweeper(pg.sql, clock);

  let rtc:RtcService|undefined;
  const diagnostics = new DiagnosticsService({
    rtcHealth:()=>rtc?.health()??Promise.resolve({status:'OFFLINE' as const,placeholder:true}),
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
    eventFabricDiagnostics: () => natsFabricHealth?.diagnostics(),
    modelGatewayHealth: async () => { const models = await modelGateway.health?.() ?? []; return { status: models.some((m) => m.status === 'healthy') ? 'HEALTHY' : models.some((m) => m.status === 'degraded') ? 'DEGRADED' : 'OFFLINE', models: models.length }; },
    countActiveObjectives: async () => { const [row] = await pg.sql<{ count: string }[]>`select count(*)::text as count from projections.objectives where status in ('active','blocked','paused')`; return Number(row?.count ?? 0); },
    visionDiagnostics: () => vision.diagnostics(),
    knowledgeStats: async () => {
      const [a, m, openConflicts, lastRun] = await Promise.all([
        atlasStore.counts(), mnemosyneStore.counts(), atlasStore.countOpenConflicts(), mnemosyneStore.lastRun(currentPrincipalId),
      ]);
      return {
        atlas: { ...a, openConflicts },
        mnemosyne: { ...m, lastConsolidationAt: lastRun?.finishedAt ?? lastRun?.startedAt ?? null },
      };
    },
  });

  const systemTelemetry: SystemTelemetry = new SystemTelemetry({sql:pg.sql,redisPing:()=>ephemeral.ping(),voice:()=>voice.diagnostics(),vision:()=>vision.diagnostics(),sourceHealth:()=>{const report=health.report();const nats=report.subsystems.find(s=>s.subsystem==='nats');return{nats:useInProc?null:nats?Number(nats.status==='HEALTHY'):null};},prometheusUrl:process.env.JARVIS_PROMETHEUS_URL??'http://127.0.0.1:9090'});
  const telemetryMonitor = new TelemetryMonitor();
  const telemetryReview = new TelemetryReview();
  const desktop = new DesktopGateway({ sql: pg.sql, diagnostics, state, sessions, approvals, agency, cognition, business, ids, nodeId: config.nodeId, systemTelemetry, voiceAudio:()=>voice.audioSnapshot(),observeScene:(principalId,nodeId,observation)=>perception.observeScene(principalId,nodeId,observation),referentFocus:()=>perception.focus(config.bootstrapPrincipalId) });
  perception.setSceneProvider(async principalId=>{const snapshot=await desktop.snapshot();if(snapshot.principalId!==principalId)throw new Error('scene principal mismatch');return snapshot.scene;});
  const experience = new ExperienceProjection({ streamId:ids.ulid(), build:()=>desktop.snapshot(), reportError:()=>{void structuredLog({component:'experience-projector',node:config.nodeId,event:'projection.failed',severity:'ERROR'});} });
  const companion=new CompanionService({sql:pg.sql,snapshot:()=>desktop.snapshot(),cognize:r=>cognition.submit(r),now:()=>clock.nowIso(),id:()=>ids.ulid(),invalidate:()=>experience.invalidate(['cognition','scene'])});
  desktop.setCompanion(companion);
  const offExperienceEvents = events.onAppended((event)=>experience.invalidate(channelsForEvent(event.type)));
  const nodeIngress=new NodeIngress({sql:pg.sql,tx,nodes,store:nodeStore,credentials,accessStore,sessions,events,clock,id:()=>ids.ulid(),status:async()=>({mode:await mode.current(),overallHealth:health.report().overall}),health:async(nodeId,online)=>{health.register({subsystem:`node:${nodeId}`,critical:false});await health.heartbeat({subsystem:`node:${nodeId}`,status:online?'HEALTHY':'OFFLINE',message:online?'authenticated heartbeat':'node unavailable'});},reportError:()=>{void structuredLog({component:'node-ingress',node:config.nodeId,event:'transport.failed',severity:'ERROR'});}});
  nodeIngress.setCompanion(companion);
  notifications.setSurfaceProvider(()=>nodeIngress.deliverySurfaces());
  notifications.registerSink(record=>nodeIngress.deliverNotification(record));
  nodeIngress.onSurfaceConnected(()=>{void notifications.retryQueued().catch(()=>undefined);});
  if(process.env.JARVIS_RTC_ENABLED==='1'){
    const apiKey=process.env.JARVIS_LIVEKIT_API_KEY,apiSecret=process.env.JARVIS_LIVEKIT_API_SECRET;if(!apiKey||!apiSecret)throw new Error('RTC requires local LiveKit credentials');
    rtc=new RtcService({url:process.env.JARVIS_LIVEKIT_URL??'ws://127.0.0.1:7880',apiKey,apiSecret,voice,invalidate:()=>experience.invalidate(['system','telemetry','scene']),validate:async binding=>{const auth=await credentials.authenticate('Bearer '+binding.accessToken,{nodeId:binding.nodeId,sessionId:binding.sessionId,scopes:['voice.write']});const node=auth?await nodeStore.get(binding.nodeId):null;return Boolean(auth&&auth.principalId===binding.principalId&&node&&!['revoked','isolated','disconnected'].includes(node.status)&&['kernel-local','owned-secure'].includes(node.trustTier)&&!['mobile','display'].includes(node.nodeType));}});
  }
  const diagnosticsHttp = new DiagnosticsHttp({ rtc,diagnostics, state, health, desktop, voice, vision, identity, sessions, credentials, nodes, nodeStore, ids, nodeId:config.nodeId, principalId:config.bootstrapPrincipalId, experience, business, companion,surfaceConnected:()=>{void notifications.retryQueued().catch(()=>undefined);} });
  notifications.setSurfaceProvider(async()=>[...await diagnosticsHttp.deliverySurfaces(),...await nodeIngress.deliverySurfaces()]);
  notifications.registerSink(record=>diagnosticsHttp.deliverNotification(record));

  const scheduler = new Scheduler({
    events,
    clock,
    ids,
    isPaused: () => health.overall === 'DEGRADED' || health.overall === 'OFFLINE',
  });

  let diagnosticsPort: number | null = null;
  let nodeIngressPort:number|null=null;
  let started = false;
  let modeRecoveryTimer: ReturnType<typeof setTimeout> | undefined;

  // --- MK.46 knowledge routine bodies (also exposed on the handle so an
  //     operator / test can trigger a pass explicitly) ----------------------
  async function runKnowledgeHarvest(): Promise<{ candidates: number; promotedFacts: number; observationsExpired: number }> {
    const harvest = await candidateSource.harvest(knowledgeHarvestCursor);
    knowledgeHarvestCursor = harvest.cursor;
    let promotedFacts = 0;
    for (const p of await observationPromoter.evaluate([currentPrincipalId])) {
      const corr = `promotion-${p.observationIds[0] ?? 'x'}`;
      const result = await knowledgeIngestion.ingest({
        kind: 'extracted_fact', correlationId: corr, principalId: p.principalId,
        provenance: { method: 'sensor', producedBy: 'observation-promoter', producedOn: config.nodeId, producedAt: clock.nowIso(), correlationId: corr, derivedFromUntrusted: false },
        fact: { subjectRef: p.subjectRef, attribute: p.attribute, value: p.value, epistemicStatus: 'observed', confidence: p.confidence, validFrom: p.observedAt, evidenceRefs: p.observationIds },
      });
      if (result.atlasFactId) {
        await atlasStore.markObservationsPromoted(p.observationIds, result.atlasFactId);
        promotedFacts++;
        await events.emit({
          type: EventNames.WorldObservationPromoted, retentionClass: 'AUDIT', privacyClass: 'INTERNAL',
          subject: { kind: 'fact', id: result.atlasFactId }, actor: { kind: 'system', id: 'observation-promoter' },
          correlationId: corr, causationId: 'knowledge.harvest', principalId: p.principalId,
          payload: { factId: result.atlasFactId, observationIds: p.observationIds, attribute: p.attribute },
        }).catch(() => undefined);
      }
    }
    const observationsExpired = await atlasStore.expireObservations(clock.nowIso());
    return { candidates: harvest.created, promotedFacts, observationsExpired };
  }

  async function runMemoryConsolidate(): Promise<{ runId: string; proposalsEmitted: number; insightsSurfaced: number }> {
    const result = await consolidator.run(currentPrincipalId);
    const insightsSurfaced = await knowledgeIngestion.surfaceInsights(currentPrincipalId, [], config.knowledge.consolidation.insightSignificanceFloor);
    await events.emit({
      type: EventNames.MemoryConsolidationCompleted, retentionClass: 'OPERATIONAL', privacyClass: 'INTERNAL',
      subject: { kind: 'consolidation-run', id: result.runId }, actor: { kind: 'system', id: 'mnemosyne.consolidate' },
      correlationId: result.runId, causationId: 'memory.consolidate', principalId: currentPrincipalId,
      payload: { runId: result.runId, proposalsEmitted: result.proposalsEmitted, ...result.outcomes },
    }).catch(() => undefined);
    return { runId: result.runId, proposalsEmitted: result.proposalsEmitted, insightsSurfaced };
  }

  function registerRoutines(): void {
    scheduler.register(ROUTINE_DEFS.healthSelfCheck!, async () => {
      const dbOk = await pg.ping();
      await health.heartbeat({
        subsystem: 'postgres',
        status: dbOk ? 'HEALTHY' : 'OFFLINE',
        message: dbOk ? 'ok' : 'ping failed',
      });
      // The health probe must precede database-dependent maintenance. During a
      // PostgreSQL outage, reap would throw before OFFLINE was ever observed.
      if (!dbOk) return;
      await agentRuntime.reap();
      await health.heartbeat({
        subsystem: 'redis',
        status: (await ephemeral.ping()) ? 'HEALTHY' : 'OFFLINE',
        message: ephemeral.connected ? 'ok' : 'down',
      });
      if (useInProc) await health.heartbeat({ subsystem: 'nats', status: 'HEALTHY', message: 'in-process bus' });
      const snapshot=await systemTelemetry.snapshot();
      for(const finding of telemetryMonitor.evaluate(snapshot))await notifications.submit({source:'sentinel.telemetry',principalId:currentPrincipalId,severity:'warning',urgency:'normal',title:finding.title,body:finding.body,dedupeKey:finding.key,correlationId:ids.ulid(),data:{reasoningRequired:finding.reasoningRequired??false}});
      experience.invalidate(['telemetry']);
      void telemetryReview.review(snapshot,{runtime:agentRuntime,principalId:currentPrincipalId,correlationId:ids.ulid(),localAvailable:config.modelLocalRouteAvailable}).then(async review=>{
        if(review)await notifications.submit({source:'argus.telemetry',principalId:currentPrincipalId,severity:'warning',urgency:'normal',title:'Unexplained queue growth reviewed',body:`Argus returned ${review.proposalCount} diagnostic answer proposal(s). Review the agent job evidence in Operations. No remediation was executed.`,dedupeKey:'telemetry.queue.review',correlationId:ids.ulid(),data:{reasoningRequired:true}});
      }).catch(()=>{void structuredLog({component:'argus.telemetry',node:config.nodeId,event:'review.unavailable',severity:'ERROR'});});
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
      /* No background autonomy: the durable engine is advanced only by explicit commands. */
    });
    scheduler.register(ROUTINE_DEFS.nodeLivenessSweep!, async () => {
      for (const node of await nodes.sweep()) {
        await events.emit({
          type: EventNames.NodeDisconnected, retentionClass: 'OPERATIONAL', privacyClass: 'INTERNAL',
          subject: { kind: 'node', id: node.nodeId }, actor: { kind: 'system', id: 'node-manager' },
          correlationId: ids.ulid(), causationId: 'node.liveness_sweep', principalId: node.principalId,
          payload: { nodeId: node.nodeId, reason: 'heartbeat_timeout' },
        }).catch(() => undefined);
      }
    });
    scheduler.register(ROUTINE_DEFS.knowledgeHarvest!, async () => { await runKnowledgeHarvest(); });
    scheduler.register(ROUTINE_DEFS.memoryConsolidate!, async () => { await runMemoryConsolidate(); });
  }

  async function reconcileModeWithHealth(overall: string): Promise<void> {
    const cur = await mode.current();
    const criticalHealthy=health.criticalDepsHealthy();
    if (cur === 'DEGRADED' && criticalHealthy) {
      const outcome=await mode.requestTransition('AMBIENT', 'dependency_recovered', 'critical dependencies healthy');
      if (!outcome.ok && outcome.code === 'guard_dwell') {
        // Recovery can arrive before mode hysteresis expires. No further
        // subsystem transition is guaranteed, so retry the deterministic
        // reconciliation itself instead of relying on an arbitrary heartbeat.
        if (!modeRecoveryTimer && started) modeRecoveryTimer = setTimeout(() => {
          modeRecoveryTimer = undefined;
          void reconcileModeWithHealth(health.report().overall).catch(() =>
            void structuredLog({component:'kernel',node:config.nodeId,event:'health.reconciliation.failed',severity:'ERROR'}));
        }, Math.max(1, config.modeMinDwellMs));
      } else if(!outcome.ok&&outcome.code!=='same_mode')throw new Error(`health-to-mode recovery failed: ${outcome.code}: ${outcome.detail}`);
    } else if (
      !criticalHealthy &&
      cur !== 'DEGRADED' &&
      cur !== 'GUARDIAN'
    ) {
      const outcome=await mode.requestTransition('DEGRADED', 'dependency_unhealthy', `overall health ${overall}`);
      if(!outcome.ok&&outcome.code!=='same_mode')throw new Error(`health-to-mode degradation failed: ${outcome.code}: ${outcome.detail}`);
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
    credentials,
    nodes,
    nodeIngress,
    get nodeIngressPort(){return nodeIngressPort;},
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
    business,
    agency,
    cognition,
    objectives,
    experience,
    atlas: atlasQuery,
    memory: memoryRecall,
    knowledge: knowledgeIngestion,
    knowledgeFacade,
    harvestKnowledge: runKnowledgeHarvest,
    consolidateMemory: runMemoryConsolidate,
    voice,
    vision,
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
      // Re-check at the process boundary even when a caller constructed a
      // KernelConfig without loadConfig(). The composition root must not offer
      // a bypass around the ingress root-of-trust guard.
      assertSecureIngressConfig(config);
      started = true;

      startTelemetry({
        serviceName: 'jarvis-core',
        serviceVersion: config.version,
        otlpEndpoint: config.otlpEndpoint,
        nodeId: config.nodeId,
        environment: process.env.NODE_ENV ?? 'development',
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
      for (const grant of ov.bootstrapGrants ?? []) { if(grant.id.startsWith('integrations:')&&await grantStore.get(grant.id))continue; await permissions.issueGrant(grant); await events.emit({ type: EventNames.GrantIssued, retentionClass: 'SECURITY', privacyClass: 'SENSITIVE', subject: { kind: 'grant', id: grant.id }, actor: { kind: 'system', id: 'permission-manager' }, correlationId: ids.ulid(), causationId: 'kernel-start', principalId: grant.principalId, payload: { grantId: grant.id, principalId: grant.principalId, version: grant.version, scopes: grant.scopes } }); }

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
        if (useInProc) await health.heartbeat({ subsystem: 'nats', status: 'HEALTHY', message: 'in-process bus' });
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        if (natsFabricHealth) await natsFabricHealth.transportUnavailable(detail, true);
        else await health.heartbeat({ subsystem: 'nats', status: 'OFFLINE', message: detail });
      }
      outboxRelay.start();
      if (useInProc) await health.heartbeat({ subsystem: 'event-fabric', status: 'HEALTHY', message: 'in-process bus and outbox relay running' });
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
      if(!(await nodeStore.get(config.nodeId))){const nodeIdentity=await identity.registerIdentity({kind:'node',principalId:principal.id,externalRef:config.nodeId,displayName:config.nodeId,trust:'verified'});await nodeStore.put({nodeId:config.nodeId,identityId:nodeIdentity.id,principalId:principal.id,nodeType:'server',trustTier:'kernel-local',capabilities:registeredCapabilities,sensors:[],outputs:['diagnostics'],softwareVersion:config.version,protocolVersion:'1',publicKeyFingerprint:`composition-root:${config.nodeId}`,status:'connected',enrolledAt:clock.nowIso(),lastSeenAt:clock.nowIso(),health:{kernel:true},version:1})}
      await state.mutate({
        key: 'active_principal',
        value: { principalId: principal.id },
        expectedVersion: -1,
        correlationId: ids.ulid(),
        actor: { kind: 'system', id: 'identity-manager' },
        reason: 'bootstrap',
      });

      // 6. Scheduler routines
      await agentRuntime.reap();
      registerRoutines();
      if (!ov.noScheduler) scheduler.start();
      await health.heartbeat({ subsystem: 'scheduler', status: 'HEALTHY', message: `${Object.keys(ROUTINE_DEFS).length} routines` });

      // 7. Diagnostics HTTP
      if(ov.nodeIngressTls)nodeIngressPort=await nodeIngress.listen(ov.nodeIngressTls);
      else if(process.env.JARVIS_NODE_INGRESS_ENABLED==='1'){
        const host=process.env.JARVIS_NODE_HOST??'127.0.0.1';if(host!=='127.0.0.1'&&host!=='::1')throw new Error('node ingress is loopback-only');
        const port=Number(process.env.JARVIS_NODE_PORT??7425);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('invalid node ingress port');
        const load=(name:string)=>{const path=process.env[name];if(!path)throw new Error(`missing ${name}`);return readFileSync(path,'utf8');};
        nodeIngressPort=await nodeIngress.listen({host,port,ca:load('JARVIS_NODE_CA_FILE'),cert:load('JARVIS_NODE_CERT_FILE'),key:load('JARVIS_NODE_KEY_FILE')});
      }
      if (!ov.noHttp) {
        diagnosticsPort = await diagnosticsHttp.listen(config.diagnosticsPort, config.diagnosticsHost);
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
      await reconcileModeWithHealth(health.report().overall);
    },

    async stop() {
      if (!started) return;
      started = false;
      await nodeIngress.close();nodeIngressPort=null;
      if (modeRecoveryTimer) clearTimeout(modeRecoveryTimer);
      modeRecoveryTimer = undefined;
      agency.stop();
      await agentRuntime.stop();
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
      await rtc?.close();
      await scheduler.stop();
      await natsFabricHealth?.stop();
      await outboxRelay.stop(); // final flush
      await stateStore.takeSnapshot(await state.checkpointEventId());
      await diagnosticsHttp.close();
      offExperienceEvents(); experience.stop();
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
