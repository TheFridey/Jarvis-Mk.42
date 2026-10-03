import type { InvocationState } from '@jarvis/contracts';
import type { DesktopCapabilityActivity, JarvisOperatingPicture, OperatingModelRun } from '@jarvis/scene';
import { MOTION } from './visual-tokens.ts';

export type LivenessStatus = 'live' | 'demo' | 'connecting' | 'reconnecting' | 'stale' | 'offline';
export interface DataLiveness {
  status: LivenessStatus;
  /** Kernel values may be presented as the current observation. */
  current: boolean;
  /** Demo fixtures: presented as current, but always labelled synthetic. */
  synthetic: boolean;
  staleSince?: number;
  label: string;
}

export function resolveLiveness(connection: { status: LivenessStatus; staleSince?: string }, demoMode: boolean): DataLiveness {
  const staleSince = connection.staleSince ? Date.parse(connection.staleSince) : undefined;
  const label = connection.status === 'live' ? 'REALTIME LIVE'
    : connection.status === 'demo' ? 'DEMO · SYNTHETIC'
    : connection.status === 'connecting' ? 'CONNECTING'
    : connection.status === 'reconnecting' ? 'RECONNECTING · DATA STALE'
    : connection.status === 'stale' ? 'DISCONNECTED · DATA STALE' : 'KERNEL OFFLINE';
  return { status: connection.status, current: connection.status === 'live' || connection.status === 'demo', synthetic: demoMode, ...(Number.isFinite(staleSince) ? { staleSince } : {}), label };
}

/** 0 while live; ramps to 1 over MOTION.freeze seconds of communication loss. */
export function freezeFactor(liveness: DataLiveness, now: number): number {
  if (liveness.current) return 0;
  if (liveness.staleSince === undefined) return 1;
  return Math.max(0, Math.min(1, (now - liveness.staleSince) / (MOTION.freeze * 1000)));
}

export function dataAgeMs(observedAt: string | undefined, now: number): number | undefined {
  const at = observedAt ? Date.parse(observedAt) : Number.NaN;
  return Number.isFinite(at) ? Math.max(0, now - at) : undefined;
}

export function formatAge(ms: number | undefined): string {
  if (ms === undefined) return 'AGE UNKNOWN';
  if (ms < 1500) return 'NOW';
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s}S AGO`;
  const m = Math.round(s / 60);
  return m < 90 ? `${m}M AGO` : `${Math.round(m / 60)}H AGO`;
}

export type ExperiencePhase =
  | 'UNAVAILABLE' | 'COMM_LOSS' | 'CRITICAL'
  | 'DORMANT' | 'AWARE' | 'LISTENING' | 'INTERPRETING' | 'RESPONDING'
  | 'THINKING' | 'ROUTING' | 'MODEL_ACTIVE' | 'FALLBACK'
  | 'APPROVAL' | 'EXECUTING' | 'VERIFYING' | 'COMPLETE'
  | 'WAITING' | 'BLOCKED' | 'ERROR' | 'DEGRADED';

export const PHASE_LABEL: Record<ExperiencePhase, string> = {
  UNAVAILABLE: 'NO KERNEL STATE', COMM_LOSS: 'COMMUNICATION LOSS', CRITICAL: 'CRITICAL',
  DORMANT: 'AMBIENT', AWARE: 'AWARE', LISTENING: 'LISTENING', INTERPRETING: 'INTERPRETING', RESPONDING: 'RESPONDING',
  THINKING: 'THINKING', ROUTING: 'ROUTING', MODEL_ACTIVE: 'MODEL ACTIVE', FALLBACK: 'FALLBACK ROUTE',
  APPROVAL: 'APPROVAL REQUIRED', EXECUTING: 'EXECUTING', VERIFYING: 'VERIFYING', COMPLETE: 'COMPLETE',
  WAITING: 'WAITING', BLOCKED: 'BLOCKED', ERROR: 'WORK FAULT', DEGRADED: 'DEGRADED',
};

/** A run whose live inference is actually confirmed by the projection. */
export function confirmedInference(run: OperatingModelRun): boolean {
  return run.status === 'running' && run.activityConfirmed !== false && run.routing?.phase === 'STARTING' && Boolean(run.modelId ?? run.routing.selectedModelId);
}

/**
 * The single cinematic phase. Kernel axes remain authoritative: work outranks
 * interaction; only authoritative OFFLINE health is CRITICAL; no model phase
 * appears without an observed model run.
 */
export function resolveExperiencePhase(picture: JarvisOperatingPicture | undefined, liveness: DataLiveness): ExperiencePhase {
  if (!liveness.current) return picture ? 'COMM_LOSS' : 'UNAVAILABLE';
  if (!picture) return 'UNAVAILABLE';
  if (picture.systemHealth?.overall === 'OFFLINE') return 'CRITICAL';
  if (picture.pendingApprovals?.length) return 'APPROVAL';
  const work = picture.workState;
  if (work === 'EXECUTING') return 'EXECUTING';
  if (work === 'VERIFYING') return 'VERIFYING';
  if (work === 'COMPLETE') return 'COMPLETE';
  if (work === 'ERROR') return 'ERROR';
  if (work === 'BLOCKED') return 'BLOCKED';
  const runs = picture.activeModels ?? [];
  if (runs.some(run => run.status === 'running' && run.routing?.phase === 'FALLBACK')) return 'FALLBACK';
  if (work === 'ROUTING' || runs.some(run => run.status === 'running' && run.routing?.phase === 'CANDIDATE')) return 'ROUTING';
  if ((work === 'THINKING' || work === 'IDLE') && runs.some(confirmedInference)) return 'MODEL_ACTIVE';
  if (work === 'THINKING') return 'THINKING';
  if (work === 'WAITING') return 'WAITING';
  const interaction = picture.interactionState;
  if (interaction === 'LISTENING' || interaction === 'INTERPRETING' || interaction === 'RESPONDING' || interaction === 'AWARE') return interaction;
  if (picture.systemHealth?.overall === 'DEGRADED') return 'DEGRADED';
  return 'DORMANT';
}

export function isIdlePhase(phase: ExperiencePhase): boolean {
  return phase === 'DORMANT' || phase === 'AWARE' || phase === 'UNAVAILABLE';
}

export type FlowStage = 'INPUT' | 'INTERPRET' | 'CONTEXT' | 'ROUTE' | 'MODEL' | 'RESULT' | 'POLICY' | 'APPROVAL' | 'EXECUTE' | 'VERIFY' | 'COMPLETE';
/** `unobserved`: the contract carries no signal for this stage; never drawn as done. */
export type FlowStatus = 'pending' | 'active' | 'done' | 'failed' | 'unobserved';
export const FLOW_STAGES: FlowStage[] = ['INPUT', 'INTERPRET', 'CONTEXT', 'ROUTE', 'MODEL', 'RESULT', 'POLICY', 'APPROVAL', 'EXECUTE', 'VERIFY', 'COMPLETE'];

const CAPABILITY_STAGE: Partial<Record<InvocationState, [FlowStage, FlowStatus]>> = {
  PROPOSED: ['POLICY', 'active'], VALIDATED: ['POLICY', 'active'], POLICY_CHECKED: ['POLICY', 'done'],
  AWAITING_APPROVAL: ['APPROVAL', 'active'], APPROVED: ['APPROVAL', 'done'],
  SIMULATING: ['EXECUTE', 'active'], SIMULATED: ['EXECUTE', 'active'], LEASE_ACQUIRED: ['EXECUTE', 'active'], EXECUTING: ['EXECUTE', 'active'],
  EXECUTED: ['EXECUTE', 'done'], VERIFYING: ['VERIFY', 'active'],
  VERIFIED: ['COMPLETE', 'done'], SUCCEEDED: ['COMPLETE', 'done'], COMPLETED: ['COMPLETE', 'done'], PARTIALLY_COMPLETED: ['COMPLETE', 'done'],
  REJECTED: ['POLICY', 'failed'], DENIED: ['APPROVAL', 'failed'], EXPIRED: ['APPROVAL', 'failed'],
  ABORTED: ['EXECUTE', 'failed'], FAILED: ['EXECUTE', 'failed'], INTERRUPTED: ['EXECUTE', 'failed'], CANCELLED: ['EXECUTE', 'failed'],
  VERIFICATION_FAILED: ['VERIFY', 'failed'], UNVERIFIED: ['VERIFY', 'failed'],
};

/** Request flow from real projection signals only. */
export function requestFlow(picture: JarvisOperatingPicture | undefined, phase: ExperiencePhase): Record<FlowStage, FlowStatus> {
  const flow = Object.fromEntries(FLOW_STAGES.map(stage => [stage, 'pending'])) as Record<FlowStage, FlowStatus>;
  if (!picture) return flow;
  const mark = (upTo: FlowStage, status: FlowStatus) => {
    const index = FLOW_STAGES.indexOf(upTo);
    FLOW_STAGES.forEach((stage, i) => {
      if (i < index && flow[stage] === 'pending') flow[stage] = stage === 'CONTEXT' || stage === 'POLICY' || stage === 'APPROVAL' ? 'unobserved' : 'done';
    });
    flow[upTo] = status;
  };
  const interaction = picture.interactionState;
  if (interaction === 'LISTENING') mark('INPUT', 'active');
  if (interaction === 'INTERPRETING') mark('INTERPRET', 'active');
  const run = picture.activeModels?.[0];
  if (phase === 'THINKING') mark('CONTEXT', 'unobserved');
  if (phase === 'ROUTING') mark('ROUTE', 'active');
  if (phase === 'MODEL_ACTIVE' || phase === 'FALLBACK') mark('MODEL', 'active');
  if (run?.status === 'completed') mark('RESULT', 'done');
  if (run?.status === 'failed') mark('MODEL', 'failed');
  const capability: DesktopCapabilityActivity | undefined = picture.activeCapabilities?.[0];
  const mapped = capability ? CAPABILITY_STAGE[capability.state] : undefined;
  if (mapped) mark(mapped[0], mapped[1]);
  if (phase === 'APPROVAL') mark('APPROVAL', 'active');
  if (phase === 'EXECUTING' && flow.EXECUTE !== 'active') mark('EXECUTE', 'active');
  if (phase === 'VERIFYING') mark('VERIFY', 'active');
  if (phase === 'COMPLETE') mark('COMPLETE', 'done');
  return flow;
}
