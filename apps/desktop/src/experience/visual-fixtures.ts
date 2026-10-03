import type { DesktopApproval, DesktopCapabilityActivity, DesktopKernelSnapshot, OperatingAgentJob, OperatingModelRun, SemanticScene, SystemTelemetrySnapshot, TelemetryReading } from '@jarvis/scene';
import type { DependencyState, HealthStatus, ModelRouteCandidate, ModelRoutingObservability } from '@jarvis/contracts';
import { demoScene } from './demo-scene.ts';
import { LocalSceneTransport, type KernelConnection } from './scene-client.ts';

/**
 * DEMO MODE ONLY. Synthetic operating pictures for visual validation of each
 * experience phase. Loaded exclusively behind NEXT_PUBLIC_JARVIS_DEMO_MODE and
 * an explicit `?scenario=` parameter; every model, provider and agent name is
 * prefixed "demo" so nothing here can be mistaken for an observation.
 */
export const VISUAL_SCENARIOS = ['ambient', 'listening', 'thinking', 'routing', 'model-active', 'fallback', 'executing', 'verifying', 'approval', 'degraded', 'critical', 'disconnected'] as const;
export type VisualScenario = typeof VISUAL_SCENARIOS[number];
export const isVisualScenario = (value: string | null): value is VisualScenario => VISUAL_SCENARIOS.includes(value as VisualScenario);

const iso = (now: number, offsetMs = 0) => new Date(now + offsetMs).toISOString();

const CANDIDATES: Record<string, ModelRouteCandidate> = {
  reasoner: { modelId: 'demo-cloud-reasoner', displayName: 'Demo Cloud Reasoner', provider: 'demo-cloud', locality: 'cloud-ok', state: 'CANDIDATE', reason: 'Deep reasoning tier for plan synthesis', contextLimitUnits: 200_000, toolSupport: true, visionSupport: true, reasoningMode: 'deep', healthState: 'healthy', circuitBreaker: 'closed' },
  swift: { modelId: 'demo-cloud-swift', displayName: 'Demo Cloud Swift', provider: 'demo-cloud', locality: 'cloud-ok', state: 'CANDIDATE', reason: 'Lower latency, shallower reasoning', contextLimitUnits: 128_000, toolSupport: true, visionSupport: false, reasoningMode: 'balanced', healthState: 'healthy', circuitBreaker: 'closed' },
  local: { modelId: 'demo-local-8b', displayName: 'Demo Local 8B', provider: 'demo-local', locality: 'local', state: 'CANDIDATE', reason: 'Private local tier; smaller context', contextLimitUnits: 32_768, toolSupport: true, visionSupport: false, reasoningMode: 'fast', healthState: 'healthy', circuitBreaker: 'closed' },
  vision: { modelId: 'demo-local-vision', displayName: 'Demo Local Vision 11B', provider: 'demo-local', locality: 'local', state: 'CANDIDATE', reason: 'Not required: request carries no image input', contextLimitUnits: 16_384, toolSupport: false, visionSupport: true, reasoningMode: 'fast', healthState: 'healthy', circuitBreaker: 'closed' },
};

function routing(now: number, phase: ModelRoutingObservability['phase'], candidates: ModelRouteCandidate[], extra: Partial<ModelRoutingObservability> = {}): ModelRoutingObservability {
  return { schemaVersion: 1, phase, correlationId: 'demo-correlation-0042', taskClass: 'plan', privacyClass: 'INTERNAL', startedAt: iso(now, -2400), candidates, fallbackModelIds: [], ...extra } as ModelRoutingObservability;
}

function run(now: number, partial: Partial<OperatingModelRun> & Pick<OperatingModelRun, 'requestId' | 'status'>): OperatingModelRun {
  return { correlationId: 'demo-correlation-0042', modelId: null, agentId: 'agents.nova', taskClass: 'plan', privacyClass: 'INTERNAL', activityConfirmed: true, startedAt: iso(now, -2400), ...partial };
}

const usage = (latencyMs: number, inputTokens: number, outputTokens: number, costEstimate: number) => ({ contextUnits: inputTokens, outputUnits: outputTokens, costEstimate, latencyMs, inputTokens, outputTokens, tokensPerSecond: Math.round(outputTokens / (latencyMs / 1000)) });

function recentRuns(now: number): OperatingModelRun[] {
  return [
    run(now, { requestId: 'demo-run-r1', status: 'completed', modelId: 'demo-local-8b', agentId: 'agents.hermes', taskClass: 'summarize', startedAt: iso(now, -312_000), finishedAt: iso(now, -309_800), latencyMs: 2200, usage: usage(2200, 1840, 412, 0), routing: routing(now - 312_000, 'COMPLETE', [{ ...CANDIDATES.local!, state: 'SELECTED' }], { selectedModelId: 'demo-local-8b', selectionReason: 'Private summarisation fits the local tier' }) }),
    run(now, { requestId: 'demo-run-r2', status: 'completed', modelId: 'demo-cloud-swift', agentId: 'agents.scout', taskClass: 'extract', startedAt: iso(now, -188_000), finishedAt: iso(now, -186_600), latencyMs: 1400, usage: usage(1400, 5200, 640, .0031), routing: routing(now - 188_000, 'COMPLETE', [{ ...CANDIDATES.swift!, state: 'SELECTED' }], { selectedModelId: 'demo-cloud-swift' }) }),
    run(now, { requestId: 'demo-run-r3', status: 'completed', modelId: 'demo-cloud-reasoner', agentId: 'agents.nova', taskClass: 'reason', startedAt: iso(now, -96_000), finishedAt: iso(now, -88_900), latencyMs: 7100, usage: usage(7100, 21400, 1880, .0412), routing: routing(now - 96_000, 'COMPLETE', [{ ...CANDIDATES.reasoner!, state: 'SELECTED' }], { selectedModelId: 'demo-cloud-reasoner' }) }),
  ];
}

const UNITS: Record<string, string> = { cpu: '%', ram: '%', gpu: '%', disk: '%', network: 'B/s', tokens: 'tokens', latency: 'ms', cost: 'cost units estimate', gateway: 'healthy', gatewayLatency: 'ms', gatewayActive: 'requests', gatewayCircuitOpen: 'circuits', agents: 'agents', queue: 'jobs', agentFailures: 'failures', natsStreamHealth: 'connected', natsPending: 'messages', postgres: 'connected', postgresLatency: 'ms', postgresSaturation: '%', outbox: 'events', redis: 'connected', redisLatency: 'ms', voice: 'ready', voiceLatency: 'ms', vision: 'ready', visionLatency: 'ms' };
const NOMINAL: Record<string, number | null> = { cpu: 23, ram: 58, gpu: 12, disk: 61, network: 182_000, tokens: 184_220, latency: 2600, cost: .412, gateway: 1, gatewayLatency: 840, gatewayActive: 0, gatewayCircuitOpen: 0, agents: 0, queue: 0, agentFailures: 0, natsStreamHealth: 1, natsPending: 4, postgres: 1, postgresLatency: 3.2, postgresSaturation: 18, outbox: 0, redis: 1, redisLatency: .9, voice: 1, voiceLatency: 96, vision: null, visionLatency: null };

function telemetry(now: number, overrides: Record<string, number | null>, overall: SystemTelemetrySnapshot['overallHealth'] = 'healthy'): SystemTelemetrySnapshot {
  const values = { ...NOMINAL, ...overrides };
  const readings: Record<string, TelemetryReading> = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value, unit: UNITS[key] ?? '', status: value === null ? 'unavailable' : 'available', observedAt: value === null ? null : iso(now, -1200) }]));
  const history = Array.from({ length: 36 }, (_, i) => ({
    at: iso(now, (i - 36) * 10_000),
    values: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value === null ? null : Math.max(0, value * (1 + Math.sin(i * .7 + key.length) * .12 + (i / 36 - .5) * .1))])),
  }));
  return { generatedAt: iso(now, -1200), window: '24h', overallHealth: overall, readings, history };
}

function dependencies(now: number, statuses: Partial<Record<string, HealthStatus>> = {}): DependencyState[] {
  return ['postgres', 'redis', 'event-bus', 'nats', 'model-gateway', 'rtc'].map(name => ({ name, status: statuses[name] ?? 'HEALTHY', placeholder: false, detail: { observedAt: iso(now) } }));
}

function job(now: number, partial: Partial<OperatingAgentJob> & Pick<OperatingAgentJob, 'jobId' | 'agentId' | 'state'>): OperatingAgentJob {
  return { correlationId: 'demo-correlation-0042', taskClass: 'plan', attempt: 1, startedAt: iso(now, -14_000), deadline: iso(now, 120_000), budget: { wallMs: 120_000, contextUnits: 64_000, costLimit: .5 }, proposalCount: 0, proposedCapabilities: [], evidenceRefs: [], activityConfirmed: true, ...partial };
}

function capability(now: number, state: DesktopCapabilityActivity['state'], offsetMs = -3000): DesktopCapabilityActivity {
  return { invocationId: 'demo-invocation-0042', capabilityId: 'capabilities.demo-workstation', action: 'apply_demo_configuration', actor: 'agents.forge', risk: 'HIGH', state, updatedAt: iso(now, offsetMs) };
}

function approval(now: number): DesktopApproval {
  return {
    id: 'demo-approval-0042', invocationId: 'demo-invocation-0042', riskClass: 'HIGH', capabilityId: 'capabilities.demo-workstation', capabilityVersion: '1.0.0',
    action: 'Apply configuration to demo staging', summary: 'Apply configuration to demo staging', expiresAt: iso(now, 4 * 60_000), nonce: 'demo-nonce', version: 1, state: 'pending', requestedAt: iso(now, -42_000), requiredAuthorisations: 1, receivedAuthorisations: 0,
    actor: 'agents.forge', resource: 'demo-staging / cluster-a / gateway.yaml', reason: 'FORGE proposes applying the reviewed gateway configuration. The change restarts two demo services.',
    scopes: ['demo.config.write', 'demo.service.restart'], arguments: { target: 'demo-staging', file: 'gateway.yaml', restart: ['demo-gateway', 'demo-relay'], dryRunPassed: true },
  };
}

function base(now: number, scene: SemanticScene): DesktopKernelSnapshot {
  const health = { overall: 'HEALTHY' as HealthStatus, generatedAt: iso(now), subsystems: [], criticalIssues: [] };
  return {
    schemaVersion: 2, operatingPictureVersion: 1, generatedAt: iso(now, -400), stateVersion: 4200, sceneVersion: scene.version,
    systemMode: 'AMBIENT', interactionState: 'DORMANT', workState: 'IDLE',
    principal: { id: 'demo-principal', status: 'active' }, presence: { status: 'present', confidence: .92, observedAt: iso(now, -5000) },
    activeObjective: { id: 'demo-objective', statement: 'Demo objective · validate the Mk.42 spatial interface across every state', status: 'active', priority: 1, updatedAt: iso(now, -600_000) },
    activeTasks: [], activeModels: [], recentModelRuns: recentRuns(now), activeAgents: [], agentJobs: [],
    activeCapabilities: [], systemHealth: health,
    telemetrySummary: { availability: 'available', generatedAt: iso(now, -1200), eventRatePerMinute: 38, traceExport: 'inactive', system: telemetry(now, {}) },
    pendingApprovals: [], conversationActivity: { activeSessionIds: [], activeRunIds: [], recentResponseIds: [] },
    selectedContext: { contextId: null, projectId: null }, principalId: 'demo-principal',
    diagnostics: {
      ok: true, generatedAt: iso(now), identity: { nodeId: 'demo-node', instanceId: 'demo-instance', version: 'demo' }, mode: 'AMBIENT', uptimeSeconds: 18_240,
      events: { ratePerMinute: 38, totalAppended: 120_442, outboxPending: 0, deadLettered: 0 },
      eventFabric: { phase: 'HEALTHY', degradeAfterMs: 30_000, outageStartedAt: null, graceDeadlineAt: null, lastConnectedAt: iso(now, -18_000_000), lastVerifiedAt: iso(now, -2000), lastRelaySuccessAt: iso(now, -1000), lastError: null, waitingForRelayEvidence: false },
      state: { stateVersion: 4200, lastMutationAt: iso(now, -9000), snapshotCheckpointEventId: null }, sessions: { active: 1, byType: { desktop: 1 } },
      objectives: { active: 1, placeholder: false }, nodes: { connected: 1, ids: ['demo-node'] }, dependencies: dependencies(now), health, alerts: { active: 0, items: [] },
    },
    state: { stateVersion: 4200, slices: {} } as unknown as DesktopKernelSnapshot['state'],
    sessions: [], notifications: [], objectives: ['demo-objective'],
    cognitionResponses: [{ requestId: 'demo-run-r3', principalId: 'demo-principal', correlationId: 'demo-correlation-0042', modelId: 'demo-cloud-reasoner', answer: 'Demo answer · Three synthetic build failures share one root cause: the demo relay certificate expired at 02:10. Renewing it clears all three.', createdAt: iso(now, -88_900) }] as unknown as DesktopKernelSnapshot['cognitionResponses'],
    capabilityActivity: [], policyDenials: [], approvals: [], scene, selectedProjectId: null, contextId: null,
  };
}

/** Compact anchors docked clear of the cognitive field. */
function fixtureScene(): SemanticScene {
  const dock: Record<string, { x: number; y: number }> = { objectives: { x: 36, y: 300 }, research: { x: 36, y: 372 }, business: { x: 36, y: 444 }, infrastructure: { x: 36, y: 516 } };
  return { ...demoScene, presentation: 'WORKING', objects: demoScene.objects.map(object => dock[object.id] ? { ...object, position: dock[object.id]! } : object) };
}

export function visualScenario(scenario: VisualScenario, now: number = Date.now()): { snapshot: DesktopKernelSnapshot; connection: KernelConnection; scene: SemanticScene } {
  const scene = fixtureScene();
  const p = base(now, scene);
  const connection: KernelConnection = { status: 'demo' };
  const active = (partial: Partial<OperatingModelRun>) => run(now, { requestId: 'demo-run-live', status: 'running', startedAt: iso(now, -3200), ...partial });
  const reasoning = () => active({
    modelId: 'demo-cloud-reasoner', firstTokenAt: iso(now, -1900), contextUnits: 41_200,
    routing: routing(now, 'STARTING', [{ ...CANDIDATES.reasoner!, state: 'SELECTED' }, { ...CANDIDATES.swift!, reason: 'Insufficient reasoning depth for multi-step plan' }, { ...CANDIDATES.local!, reason: 'Context requirement exceeds 32K local window' }, CANDIDATES.vision!], { selectedModelId: 'demo-cloud-reasoner', selectionReason: 'Deep reasoning required · context 41K exceeds local window', firstTokenAt: iso(now, -1900) }),
  });
  const novaJobs = (state: OperatingAgentJob['state'], modelId?: string) => [
    job(now, { jobId: 'demo-job-nova', agentId: 'agents.nova', state, ...(modelId ? { selectedModelId: modelId } : {}), activityStage: state }),
    job(now, { jobId: 'demo-job-scout', agentId: 'agents.scout', state: 'QUEUED', parentJobId: 'demo-job-nova', taskClass: 'extract', activityConfirmed: false }),
  ];
  switch (scenario) {
    case 'ambient': break;
    case 'listening':
      Object.assign(p, { systemMode: 'FOCUSED', interactionState: 'LISTENING', voiceAudio: { observedAt: iso(now), wakeConfidence: .94, vad: 'speech', amplitude: .42 + Math.abs(Math.sin(now / 340)) * .4, partialTranscript: 'Jarvis, summarise the overnight demo build failures and tell me', tts: 'idle', playbackAmplitude: 0, deviceState: 'ready' } });
      break;
    case 'thinking':
      Object.assign(p, { systemMode: 'FOCUSED', interactionState: 'INTERPRETING', workState: 'THINKING', activeModels: [active({ routing: undefined })], agentJobs: novaJobs('RUNNING') });
      break;
    case 'routing':
      Object.assign(p, { systemMode: 'FOCUSED', workState: 'ROUTING', activeModels: [active({ routing: routing(now, 'CANDIDATE', [CANDIDATES.reasoner!, CANDIDATES.swift!, CANDIDATES.local!, CANDIDATES.vision!]) })], agentJobs: novaJobs('RUNNING') });
      p.telemetrySummary.system = telemetry(now, { gatewayActive: 1 });
      break;
    case 'model-active':
      Object.assign(p, { systemMode: 'FOCUSED', workState: 'THINKING', activeModels: [reasoning()], agentJobs: novaJobs('RUNNING', 'demo-cloud-reasoner') });
      p.telemetrySummary.system = telemetry(now, { gatewayActive: 1, gpu: 18, cpu: 31 });
      break;
    case 'fallback': {
      const failed = { ...CANDIDATES.reasoner!, state: 'FAILED' as const, reason: 'Demo provider timeout · no first token in 8s', healthState: 'degraded' as const, circuitBreaker: 'open' as const };
      Object.assign(p, {
        systemMode: 'FOCUSED', workState: 'ROUTING', agentJobs: novaJobs('RUNNING', 'demo-local-8b'),
        activeModels: [active({ modelId: 'demo-local-8b', contextUnits: 21_400, routing: routing(now, 'FALLBACK', [failed, { ...CANDIDATES.local!, state: 'SELECTED' }, { ...CANDIDATES.swift!, state: 'UNAVAILABLE', reason: 'Demo cloud provider circuit shared with primary' }], { selectedModelId: 'demo-local-8b', fallbackModelIds: ['demo-local-8b'], fallbackReason: 'TIMEOUT · primary exceeded first-token budget', errorClass: 'TIMEOUT' }) })],
      });
      p.telemetrySummary.system = telemetry(now, { gatewayCircuitOpen: 1, gatewayLatency: 8200, gpu: 64 });
      break;
    }
    case 'executing': case 'verifying': {
      const state = scenario === 'executing' ? 'EXECUTING' : 'VERIFYING';
      const effect = capability(now, state);
      Object.assign(p, {
        systemMode: 'GUARDIAN', workState: state, activeCapabilities: [effect], capabilityActivity: [effect, { ...capability(now, 'APPROVED', -9000), invocationId: 'demo-invocation-0042-approved' }],
        agentJobs: [job(now, { jobId: 'demo-job-forge', agentId: 'agents.forge', state: 'RUNNING', taskClass: 'code', activityStage: scenario === 'verifying' ? 'VERIFYING' : 'RUNNING', capabilityActivity: [{ invocationId: effect.invocationId, capabilityId: effect.capabilityId, state }] }), job(now, { jobId: 'demo-job-sentinel', agentId: 'agents.sentinel', state: 'WAITING', parentJobId: 'demo-job-forge', taskClass: 'classify' })],
      });
      p.telemetrySummary.system = telemetry(now, { agents: 2, queue: 1, postgresLatency: 6.4, outbox: 3, cpu: 47 });
      break;
    }
    case 'approval': {
      const pending = approval(now);
      Object.assign(p, {
        systemMode: 'GUARDIAN', workState: 'WAITING', pendingApprovals: [pending], approvals: [pending], activeCapabilities: [capability(now, 'AWAITING_APPROVAL')], capabilityActivity: [capability(now, 'AWAITING_APPROVAL')],
        agentJobs: [job(now, { jobId: 'demo-job-forge', agentId: 'agents.forge', state: 'WAITING', taskClass: 'code', activityStage: 'WAITING_APPROVAL', proposalCount: 1, proposedCapabilities: ['capabilities.demo-workstation'] })],
      });
      p.telemetrySummary.system = telemetry(now, { agents: 1, queue: 1 });
      break;
    }
    case 'degraded': {
      const deps = dependencies(now, { redis: 'DEGRADED', 'model-gateway': 'DEGRADED' });
      Object.assign(p, { systemMode: 'DEGRADED', systemHealth: { ...p.systemHealth, overall: 'DEGRADED', criticalIssues: ['redis'] } });
      p.diagnostics = { ...p.diagnostics, dependencies: deps, health: p.systemHealth };
      p.telemetrySummary.system = telemetry(now, { redisLatency: 118, gatewayCircuitOpen: 2, gatewayLatency: 4600 }, 'degraded');
      break;
    }
    case 'critical': {
      const deps = dependencies(now, { postgres: 'OFFLINE' });
      Object.assign(p, { systemMode: 'DEGRADED', systemHealth: { ...p.systemHealth, overall: 'OFFLINE', criticalIssues: ['postgres'] } });
      p.diagnostics = { ...p.diagnostics, ok: false, dependencies: deps, health: p.systemHealth };
      p.telemetrySummary.system = telemetry(now, { postgres: 0, postgresLatency: null, outbox: 1840 }, 'degraded');
      break;
    }
    case 'disconnected':
      Object.assign(p, { systemMode: 'FOCUSED', workState: 'THINKING', activeModels: [reasoning()], agentJobs: novaJobs('RUNNING', 'demo-cloud-reasoner'), generatedAt: iso(now, -24_000) });
      p.telemetrySummary.system = { ...telemetry(now - 24_000, {}), generatedAt: iso(now, -24_000) };
      return { snapshot: p, connection: { status: 'stale', staleSince: iso(now, -22_000), error: 'demo transport severed' }, scene };
  }
  return { snapshot: p, connection, scene };
}

const TICKING: VisualScenario[] = ['listening', 'model-active', 'routing', 'executing', 'verifying', 'fallback'];

/** Demo transport carrying a synthetic picture; commands remain refused by LocalSceneTransport. */
export class FixtureSceneTransport extends LocalSceneTransport {
  private timer?: ReturnType<typeof setInterval>;
  constructor(private readonly scenario: VisualScenario) { super(visualScenario(scenario).scene); }
  override subscribeKernel(listener: (snapshot: DesktopKernelSnapshot | undefined) => void) {
    listener(visualScenario(this.scenario).snapshot);
    if (TICKING.includes(this.scenario)) this.timer = setInterval(() => listener(visualScenario(this.scenario).snapshot), 1000);
    return () => { if (this.timer) clearInterval(this.timer); return undefined; };
  }
  override subscribeConnection(listener: (state: KernelConnection) => void) {
    listener(visualScenario(this.scenario).connection);
    return () => undefined;
  }
  override close() { if (this.timer) clearInterval(this.timer); super.close(); }
}
