import type { DesktopKernelSnapshot, OperatingAgentJob, OperatingModelRun } from '@jarvis/scene';
import type { KernelConnection } from './scene-client.ts';
import { LocalSceneTransport } from './scene-client.ts';
import { CANDIDATES, capability, iso, job, routing, run, telemetry, usage, visualScenario, type VisualScenario } from './visual-fixtures.ts';

/**
 * DEMO MODE ONLY. Deterministic synthetic timelines for motion QA of the
 * presentation choreography. Loaded only behind NEXT_PUBLIC_JARVIS_DEMO_MODE
 * and an explicit `?sequence=` parameter; every name stays "demo"-prefixed.
 * Each step is a complete operating picture, exactly what a Kernel would push,
 * so the renderer is exercised through its normal observation path.
 */
export const DEMO_SEQUENCES = ['conversation', 'fallback', 'execution', 'liveness'] as const;
export type DemoSequence = typeof DEMO_SEQUENCES[number];
export const isDemoSequence = (value: string | null): value is DemoSequence => DEMO_SEQUENCES.includes(value as DemoSequence);

export interface SequenceStep {
  /** Milliseconds after the sequence starts. */
  at: number;
  label: string;
  /** Absent: the transport stops pushing pictures (the last one goes stale). */
  snapshot?: (now: number) => DesktopKernelSnapshot;
  connection: (now: number) => KernelConnection;
}

const demo = (): KernelConnection => ({ status: 'demo' });
const LIVE = 'demo-run-live';

function scenario(name: VisualScenario, now: number, version: number, patch?: (snapshot: DesktopKernelSnapshot) => void): DesktopKernelSnapshot {
  const snapshot = visualScenario(name, now).snapshot;
  snapshot.stateVersion = 4200 + version;
  patch?.(snapshot);
  return snapshot;
}

const reasonerSelected = (now: number, startedAt: number): OperatingModelRun => run(now, {
  requestId: LIVE, status: 'running', startedAt: iso(startedAt), modelId: 'demo-cloud-reasoner', firstTokenAt: iso(now, -600), contextUnits: 41_200,
  routing: routing(startedAt, 'STARTING', [{ ...CANDIDATES.reasoner!, state: 'SELECTED' }, { ...CANDIDATES.swift!, reason: 'Insufficient reasoning depth for multi-step plan' }, { ...CANDIDATES.local!, reason: 'Context requirement exceeds 32K local window' }, CANDIDATES.vision!], { selectedModelId: 'demo-cloud-reasoner', selectionReason: 'Deep reasoning required · context 41K exceeds local window', firstTokenAt: iso(now, -600) }),
});

const completedLive = (now: number, startedAt: number): OperatingModelRun => ({
  ...reasonerSelected(now, startedAt), status: 'completed', finishedAt: iso(now, -200), latencyMs: now - 200 - startedAt, usage: usage(Math.max(1, now - 200 - startedAt), 41_200, 1_240, .0218),
  routing: routing(startedAt, 'COMPLETE', [{ ...CANDIDATES.reasoner!, state: 'SELECTED' }], { selectedModelId: 'demo-cloud-reasoner' }),
});

const responseFor = (now: number) => [{ requestId: LIVE, principalId: 'demo-principal', correlationId: 'demo-correlation-0042', modelId: 'demo-cloud-reasoner', answer: 'Demo answer · the three synthetic build failures share one expired demo relay certificate.', createdAt: iso(now, -150) }] as unknown as DesktopKernelSnapshot['cognitionResponses'];

/** AMBIENT → LISTENING → THINKING → ROUTING → MODEL_ACTIVE → RESPONDING → AMBIENT */
function conversation(): SequenceStep[] {
  let started = 0;
  return [
    { at: 0, label: 'AMBIENT', snapshot: now => scenario('ambient', now, 0), connection: demo },
    { at: 3000, label: 'LISTENING', snapshot: now => scenario('listening', now, 1), connection: demo },
    { at: 6000, label: 'THINKING', snapshot: now => { started = now; return scenario('thinking', now, 2, p => { p.activeModels = [run(now, { requestId: LIVE, status: 'running', startedAt: iso(now) })]; }); }, connection: demo },
    { at: 9000, label: 'ROUTING', snapshot: now => scenario('routing', now, 3, p => { p.activeModels = [run(now, { requestId: LIVE, status: 'running', startedAt: iso(started), routing: routing(started, 'CANDIDATE', [CANDIDATES.reasoner!, CANDIDATES.swift!, CANDIDATES.local!, CANDIDATES.vision!]) })]; }), connection: demo },
    { at: 12000, label: 'MODEL_ACTIVE', snapshot: now => scenario('model-active', now, 4, p => { p.activeModels = [reasonerSelected(now, started)]; }), connection: demo },
    { at: 17000, label: 'RESPONDING', snapshot: now => scenario('ambient', now, 5, p => { p.interactionState = 'RESPONDING'; p.recentModelRuns = [completedLive(now, started), ...p.recentModelRuns]; p.cognitionResponses = responseFor(now); }), connection: demo },
    { at: 21000, label: 'AMBIENT', snapshot: now => scenario('ambient', now, 6, p => { p.recentModelRuns = [completedLive(now - 4000, started), ...p.recentModelRuns]; p.cognitionResponses = responseFor(now - 4000); }), connection: demo },
  ];
}

/** ROUTING → PRIMARY FAILURE → FALLBACK → MODEL_ACTIVE, crossing the cloud/local boundary. */
function fallback(): SequenceStep[] {
  let started = 0;
  const failed = { ...CANDIDATES.reasoner!, state: 'FAILED' as const, reason: 'Demo provider timeout · no first token in 8s', healthState: 'degraded' as const, circuitBreaker: 'open' as const };
  const swiftDown = { ...CANDIDATES.swift!, state: 'UNAVAILABLE' as const, reason: 'Demo cloud provider circuit shared with primary' };
  const jobs = (now: number, modelId?: string): OperatingAgentJob[] => [job(now, { jobId: 'demo-job-nova', agentId: 'agents.nova', state: 'RUNNING', activityStage: 'RUNNING', ...(modelId ? { selectedModelId: modelId } : {}) })];
  return [
    { at: 0, label: 'ROUTING', snapshot: now => { started = now; return scenario('routing', now, 0, p => { p.activeModels = [run(now, { requestId: LIVE, status: 'running', startedAt: iso(now), routing: routing(now, 'CANDIDATE', [CANDIDATES.reasoner!, CANDIDATES.swift!, CANDIDATES.local!]) })]; p.agentJobs = jobs(now); }); }, connection: demo },
    { at: 3000, label: 'PRIMARY_SELECTED', snapshot: now => scenario('model-active', now, 1, p => { p.activeModels = [run(now, { requestId: LIVE, status: 'running', startedAt: iso(started), modelId: 'demo-cloud-reasoner', contextUnits: 21_400, routing: routing(started, 'STARTING', [{ ...CANDIDATES.reasoner!, state: 'SELECTED' }, CANDIDATES.swift!, CANDIDATES.local!], { selectedModelId: 'demo-cloud-reasoner' }) })]; p.agentJobs = jobs(now, 'demo-cloud-reasoner'); }), connection: demo },
    { at: 7000, label: 'PRIMARY_FAILURE', snapshot: now => scenario('routing', now, 2, p => { p.workState = 'ROUTING'; p.activeModels = [run(now, { requestId: LIVE, status: 'running', startedAt: iso(started), routing: routing(started, 'CANDIDATE', [failed, swiftDown, CANDIDATES.local!], { errorClass: 'TIMEOUT' }) })]; p.agentJobs = jobs(now); p.telemetrySummary.system = telemetry(now, { gatewayCircuitOpen: 1, gatewayLatency: 8200 }); }), connection: demo },
    { at: 9000, label: 'FALLBACK', snapshot: now => scenario('fallback', now, 3, p => { p.activeModels = [run(now, { requestId: LIVE, status: 'running', startedAt: iso(started), modelId: 'demo-local-8b', contextUnits: 21_400, routing: routing(started, 'FALLBACK', [failed, { ...CANDIDATES.local!, state: 'SELECTED' }, swiftDown], { selectedModelId: 'demo-local-8b', fallbackModelIds: ['demo-local-8b'], fallbackReason: 'TIMEOUT · primary exceeded first-token budget', errorClass: 'TIMEOUT' }) })]; p.agentJobs = jobs(now, 'demo-local-8b'); }), connection: demo },
    { at: 13000, label: 'MODEL_ACTIVE', snapshot: now => scenario('model-active', now, 4, p => { p.activeModels = [run(now, { requestId: LIVE, status: 'running', startedAt: iso(started), modelId: 'demo-local-8b', firstTokenAt: iso(now, -400), contextUnits: 21_400, routing: routing(started, 'STARTING', [failed, { ...CANDIDATES.local!, state: 'SELECTED' }, swiftDown], { selectedModelId: 'demo-local-8b', fallbackModelIds: ['demo-local-8b'], fallbackReason: 'TIMEOUT · primary exceeded first-token budget', firstTokenAt: iso(now, -400) }) })]; p.agentJobs = jobs(now, 'demo-local-8b'); p.telemetrySummary.system = telemetry(now, { gatewayCircuitOpen: 1, gpu: 64 }); }), connection: demo },
  ];
}

/** THINKING → AGENT WORK → EXECUTION → APPROVAL → EXECUTION → VERIFY → COMPLETE */
function execution(): SequenceStep[] {
  const forge = (now: number, state: OperatingAgentJob['state'], stage: NonNullable<OperatingAgentJob['activityStage']>, extra: Partial<OperatingAgentJob> = {}) => job(now, { jobId: 'demo-job-forge', agentId: 'agents.forge', state, taskClass: 'code', activityStage: stage, ...extra });
  const scout = (now: number, state: OperatingAgentJob['state']) => job(now, { jobId: 'demo-job-scout', agentId: 'agents.scout', state, taskClass: 'extract', parentJobId: 'demo-job-nova' });
  const nova = (now: number, state: OperatingAgentJob['state']) => job(now, { jobId: 'demo-job-nova', agentId: 'agents.nova', state, activityStage: state });
  return [
    { at: 0, label: 'THINKING', snapshot: now => scenario('thinking', now, 0, p => { p.agentJobs = [nova(now, 'RUNNING')]; }), connection: demo },
    { at: 3000, label: 'AGENT_WORK', snapshot: now => scenario('thinking', now, 1, p => { p.agentJobs = [nova(now, 'RUNNING'), scout(now, 'LEASED'), forge(now, 'QUEUED', 'QUEUED')]; }), connection: demo },
    { at: 6000, label: 'EXECUTION', snapshot: now => scenario('executing', now, 2, p => { const effect = capability(now, 'SIMULATING'); p.activeCapabilities = [effect]; p.capabilityActivity = [effect]; p.activeModels = []; p.agentJobs = [nova(now, 'WAITING'), scout(now, 'COMPLETE'), forge(now, 'RUNNING', 'RUNNING')]; }), connection: demo },
    { at: 9000, label: 'APPROVAL', snapshot: now => scenario('approval', now, 3, p => { p.agentJobs = [nova(now, 'WAITING'), forge(now, 'WAITING', 'WAITING_APPROVAL', { proposalCount: 1, proposedCapabilities: ['capabilities.demo-workstation'] })]; }), connection: demo },
    { at: 13000, label: 'EXECUTION', snapshot: now => scenario('executing', now, 4, p => { p.agentJobs = [nova(now, 'WAITING'), forge(now, 'RUNNING', 'RUNNING')]; }), connection: demo },
    { at: 16000, label: 'VERIFY', snapshot: now => scenario('verifying', now, 5, p => { p.agentJobs = [nova(now, 'WAITING'), forge(now, 'RUNNING', 'VERIFYING')]; }), connection: demo },
    { at: 19000, label: 'COMPLETE', snapshot: now => scenario('ambient', now, 6, p => { const effect = capability(now, 'VERIFIED'); p.workState = 'COMPLETE'; p.systemMode = 'GUARDIAN'; p.activeCapabilities = [effect]; p.capabilityActivity = [effect]; p.agentJobs = [nova(now, 'COMPLETE'), forge(now, 'COMPLETE', 'COMPLETE')]; }), connection: demo },
    { at: 23000, label: 'AMBIENT', snapshot: now => scenario('ambient', now, 7), connection: demo },
  ];
}

/** LIVE → STALE → COMM_LOSS: pictures stop arriving; the transport reports what it knows. */
function liveness(): SequenceStep[] {
  let lost = 0;
  return [
    { at: 0, label: 'LIVE', snapshot: now => scenario('model-active', now, 0), connection: demo },
    { at: 4000, label: 'STALE', connection: now => { lost = now; return { status: 'reconnecting', staleSince: iso(now), error: 'demo heartbeat missed' }; } },
    { at: 9000, label: 'COMM_LOSS', connection: () => ({ status: 'stale', staleSince: iso(lost), error: 'demo transport severed' }) },
  ];
}

export function sequenceSteps(sequence: DemoSequence): SequenceStep[] {
  switch (sequence) {
    case 'conversation': return conversation();
    case 'fallback': return fallback();
    case 'execution': return execution();
    case 'liveness': return liveness();
  }
}

/** Plays a sequence once after `leadMs`, holding step 0 meanwhile and the final step afterwards. */
export class SequenceSceneTransport extends LocalSceneTransport {
  private readonly timers: ReturnType<typeof setTimeout>[] = [];
  private readonly kernelListeners = new Set<(snapshot: DesktopKernelSnapshot | undefined) => void>();
  private readonly connectionListeners = new Set<(state: KernelConnection) => void>();
  private readonly steps: SequenceStep[];
  private started = false;
  private last?: DesktopKernelSnapshot;
  private status: KernelConnection = demo();

  constructor(readonly sequence: DemoSequence, private readonly leadMs = 3000) {
    super(visualScenario('ambient').scene);
    this.steps = sequenceSteps(sequence);
  }

  override subscribeKernel(listener: (snapshot: DesktopKernelSnapshot | undefined) => void) {
    this.kernelListeners.add(listener);
    this.start();
    listener(this.last);
    return () => { this.kernelListeners.delete(listener); return undefined; };
  }

  override subscribeConnection(listener: (state: KernelConnection) => void) {
    this.connectionListeners.add(listener);
    this.start();
    listener(this.status);
    return () => { this.connectionListeners.delete(listener); return undefined; };
  }

  private start() {
    if (this.started) return;
    this.started = true;
    this.apply(0);
    this.steps.forEach((step, index) => { if (index > 0) this.timers.push(setTimeout(() => this.apply(index), this.leadMs + step.at)); });
  }

  private apply(index: number) {
    const step = this.steps[index]!;
    const now = Date.now();
    this.status = step.connection(now);
    if (step.snapshot) this.last = step.snapshot(now);
    if (typeof document !== 'undefined') { document.documentElement.dataset.demoStep = `${index}:${step.label}`; document.documentElement.dataset.demoSteps = String(this.steps.length); }
    this.connectionListeners.forEach(listener => listener(this.status));
    if (step.snapshot) this.kernelListeners.forEach(listener => listener(this.last));
  }

  override close() { this.timers.forEach(clearTimeout); super.close(); }
}
