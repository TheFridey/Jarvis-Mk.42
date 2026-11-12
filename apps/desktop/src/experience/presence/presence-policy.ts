/**
 * SENTIENCE Presence policy: a pure, deterministic reading of the existing
 * Kernel projection into one of nine presence states, plus the spatial
 * composition, satellite mapping and motion budget the Presence Mode renders.
 *
 * It never invents state. Every value here is either a direct reading of an
 * authoritative axis (`workState`, `interactionState`, `systemHealth`,
 * `pendingApprovals`, `agentJobs`) or an explicit consequence of the data
 * liveness contract. `experience-phase-policy` still owns the canonical phase;
 * this module only decides how that phase is presented, and what must remain
 * visible no matter how calm the presentation is.
 */
import { agentField, type AgentNodeState } from '../agent-field-policy.ts';
import type { ExperiencePhase, DataLiveness } from '../experience-phase-policy.ts';
import { polar, spatialLayout, type Point, type SpatialLayout } from '../spatial-layout-policy.ts';
import type { CoreSystemTargets } from '../core-visual-policy.ts';
import type { OperatingAgentJob } from '@jarvis/scene';

/** The nine states Presence Mode is allowed to express. */
export type PresenceState =
  | 'DISCONNECTED' | 'FAULT' | 'APPROVAL' | 'EXECUTING' | 'VERIFIED'
  | 'SPEAKING' | 'LISTENING' | 'THINKING' | 'STANDBY';

export type PresenceTone = 'muted' | 'critical' | 'attention' | 'execution' | 'verified' | 'cognition' | 'idle';

/** Phase → presence state before precedence is applied. Exhaustive on purpose. */
const PHASE_STATE: Record<ExperiencePhase, PresenceState> = {
  UNAVAILABLE: 'DISCONNECTED', COMM_LOSS: 'DISCONNECTED', CRITICAL: 'FAULT',
  DORMANT: 'STANDBY', AWARE: 'STANDBY', DEGRADED: 'STANDBY', WAITING: 'STANDBY',
  LISTENING: 'LISTENING', INTERPRETING: 'THINKING', RESPONDING: 'SPEAKING',
  THINKING: 'THINKING', ROUTING: 'THINKING', MODEL_ACTIVE: 'THINKING', FALLBACK: 'THINKING',
  APPROVAL: 'APPROVAL', EXECUTING: 'EXECUTING', VERIFYING: 'EXECUTING', COMPLETE: 'VERIFIED',
  BLOCKED: 'FAULT', ERROR: 'FAULT',
};

const TONE: Record<PresenceState, PresenceTone> = {
  DISCONNECTED: 'muted', FAULT: 'critical', APPROVAL: 'attention', EXECUTING: 'execution',
  VERIFIED: 'verified', SPEAKING: 'cognition', LISTENING: 'cognition', THINKING: 'cognition', STANDBY: 'idle',
};

const WORD: Record<PresenceState, string> = {
  DISCONNECTED: 'DISCONNECTED', FAULT: 'FAULT', APPROVAL: 'AWAITING YOU', EXECUTING: 'EXECUTING',
  VERIFIED: 'VERIFIED', SPEAKING: 'SPEAKING', LISTENING: 'LISTENING', THINKING: 'THINKING', STANDBY: 'STANDBY',
};

/** Structural subset of `JarvisOperatingPicture`; keeps this module test-pure. */
export interface PresencePicture {
  pendingApprovals?: ReadonlyArray<{ action?: string; summary?: string; riskClass?: string }>;
  activeCapabilities?: ReadonlyArray<{ action: string; state: string }>;
  agentJobs?: ReadonlyArray<OperatingAgentJob>;
  voiceAudio?: { tts?: string };
  systemHealth?: { overall?: string };
  systemMode?: string;
}

export interface PresenceInput {
  phase: ExperiencePhase;
  liveness: DataLiveness;
  picture?: PresencePicture | undefined;
}

/**
 * Deterministic precedence, highest first:
 *   1. DISCONNECTED — no current observation; nothing downstream may claim activity.
 *   2. FAULT        — authoritative critical health, work error, or blocked work.
 *   3. APPROVAL     — an operator decision is outstanding; it outranks activity
 *                     because it is the only state that needs the human.
 *   4. EXECUTING    — real capability work (EXECUTING/VERIFYING).
 *   5. VERIFIED     — completion. Success is a controller-verified state, not a
 *                     model claim; the phase already encodes that.
 *   6. SPEAKING     — measured speech (RESPONDING, or a live TTS playback flag).
 *   7. LISTENING / THINKING / STANDBY — remaining interaction and idle states.
 */
export function resolvePresenceState(input: PresenceInput): PresenceState {
  const { phase, liveness, picture } = input;
  if (!liveness.current) return 'DISCONNECTED';
  if (phase === 'CRITICAL' || phase === 'ERROR' || phase === 'BLOCKED') return 'FAULT';
  const approvals = picture?.pendingApprovals?.length ?? 0;
  if (approvals > 0 || phase === 'APPROVAL') return 'APPROVAL';
  const base = PHASE_STATE[phase];
  if (base === 'EXECUTING' || base === 'VERIFIED') return base;
  if (picture?.voiceAudio?.tts === 'playing') return 'SPEAKING';
  return base;
}

export function presenceTone(state: PresenceState): PresenceTone {
  return TONE[state];
}

/** The single word the orb carries. `presenceDetail` is the accessible sentence. */
export function presenceWord(state: PresenceState, liveness: Pick<DataLiveness, 'status'>): string {
  if (state === 'DISCONNECTED') return liveness.status === 'reconnecting' || liveness.status === 'stale' ? 'STALE' : 'DISCONNECTED';
  return WORD[state];
}

/**
 * One short, truthful line. It states only what the projection carries; when a
 * signal is absent the line says so rather than filling the gap.
 */
export function presenceDetail(input: PresenceInput): string {
  const { phase, liveness, picture } = input;
  const state = resolvePresenceState(input);
  if (state === 'DISCONNECTED') return liveness.staleSince === undefined ? 'No authoritative state is being shown.' : `Last observation ${formatAge(Date.now() - liveness.staleSince)}. Decisions are unavailable.`;
  if (state === 'FAULT') {
    if (phase === 'CRITICAL') return 'Kernel health is offline.';
    const failed = picture?.activeCapabilities?.[0];
    return failed ? `${failed.action} · ${failed.state}` : 'Work fault reported. The cause is not in the projection.';
  }
  if (state === 'APPROVAL') {
    const first = picture?.pendingApprovals?.[0];
    const label = first?.action ?? first?.summary;
    const extra = (picture?.pendingApprovals?.length ?? 0) - 1;
    return `${label ? label : 'An action requires authorisation.'}${first?.riskClass ? ` · ${first.riskClass} risk` : ''}${extra > 0 ? ` · +${extra} more` : ''}`;
  }
  if (state === 'EXECUTING') {
    const capability = picture?.activeCapabilities?.[0];
    return capability ? `${capability.action} · ${capability.state}` : 'Capability activity observed.';
  }
  if (state === 'VERIFIED') return 'Effect verified. No further action is outstanding.';
  if (state === 'SPEAKING') return 'Responding.';
  if (state === 'LISTENING') return 'Capturing input.';
  if (state === 'THINKING') return phase === 'ROUTING' ? 'Selecting a route.' : 'Reasoning.';
  const agents = picture?.agentJobs?.filter(job => !TERMINAL_JOB_STATES.has(job.state)).length ?? 0;
  if (agents > 0) return `${agents} agent job${agents === 1 ? '' : 's'} in flight.`;
  return liveness.synthetic ? 'Synthetic data. No live execution.' : 'Standing by.';
}

/** Terminal `OperatingAgentJob` states; a job in one of these is history, not presence. */
const TERMINAL_JOB_STATES = new Set<string>(['COMPLETE', 'FAILED', 'CANCELLED']);

export function formatAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'age unknown';
  const seconds = Math.round(ms / 1000);
  if (seconds < 90) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return minutes < 90 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`;
}

/**
 * Chrome contract. Approvals are shown whenever they exist, in every state —
 * including DISCONNECTED, where the decision controls are disabled rather than
 * the decision hidden. The command centre is always reachable.
 */
export interface PresenceChrome {
  showApprovals: boolean;
  decisionsAllowed: boolean;
  commandCentreReachable: boolean;
  /** A renderer fallback never suppresses state; it only suppresses the GPU layer. */
  authoritativeTextAlwaysVisible: boolean;
}

export function presenceChrome(input: { approvals: number; liveness: DataLiveness }): PresenceChrome {
  return {
    showApprovals: input.approvals > 0,
    decisionsAllowed: input.liveness.current && !input.liveness.synthetic,
    commandCentreReachable: true,
    authoritativeTextAlwaysVisible: true,
  };
}

/* ---------------------------------------------------------------- composition */

export interface PresenceComposition {
  layout: SpatialLayout;
  coreRadius: number;
  satelliteRadius: number;
  /** Y coordinate where the readout block begins; UI must not cross it. */
  horizon: number;
}

/**
 * Presence framing: one dominant orb, wide negative space, the readout far
 * enough below the core that the light never washes out the words. Both DOM and
 * GPU consume the returned `SpatialLayout`, so geometry and labels cannot drift.
 */
export function presenceComposition(viewport: { width: number; height: number }): PresenceComposition {
  const width = Math.max(320, viewport.width);
  const height = Math.max(320, viewport.height);
  const narrow = width < 900 || height < 620;
  const base = spatialLayout({ width, height, models: [], agentCount: 0 });
  const coreRadius = narrow ? Math.min(width * .3, height * .2) : Math.min(height * .335, width * .235);
  const core: Point = { x: width * .5, y: height * (narrow ? .4 : .455) };
  const satelliteRadius = coreRadius * 1.62;
  const layout: SpatialLayout = {
    ...base,
    width, height, narrow, core, coreRadius, models: [], agents: [], agentRadius: satelliteRadius,
    modelRadius: satelliteRadius,
    execution: { barrier: polar(core, coreRadius * 1.5, 232), anchor: polar(core, coreRadius * 2.05, 232), angle: 232 },
    conversation: polar(core, coreRadius * 1.3, 186),
    conversationWidth: Math.round(Math.max(200, Math.min(420, width * .34))),
  };
  return { layout, coreRadius, satelliteRadius, horizon: core.y + coreRadius * 1.1 };
}

/**
 * Calmer motion for the presence composition. Colours and state semantics come
 * from `coreSystemTargets`; this only reduces speed and steadies luminosity so a
 * larger orb does not feel agitated. No state is added or removed.
 */
export function presenceCoreTargets(base: CoreSystemTargets): CoreSystemTargets {
  return {
    ...base,
    rings: Math.min(base.rings, 4),
    orbitSpeed: base.orbitSpeed * .55,
    orbitIndependence: base.orbitIndependence * .7,
    luminosity: Math.min(1, base.luminosity * .92 + .06),
  };
}

export interface PresenceMotion {
  ambient: number;
  satellitesAnimated: boolean;
  breath: number;
}

/** Reduced motion stops continuous motion; it never changes the state word. */
export function presenceMotion(reduced: boolean, state: PresenceState): PresenceMotion {
  if (reduced) return { ambient: 0, satellitesAnimated: false, breath: 0 };
  const ambient: Record<PresenceState, number> = {
    DISCONNECTED: .25, FAULT: .45, APPROVAL: .16, EXECUTING: .9, VERIFIED: .5,
    SPEAKING: .8, LISTENING: .6, THINKING: 1, STANDBY: .38,
  };
  return { ambient: ambient[state], satellitesAnimated: state === 'EXECUTING' || state === 'THINKING', breath: state === 'STANDBY' ? .35 : .15 };
}

/* ------------------------------------------------------------------ satellites */

export const TERMINAL_AGENT_STATES = new Set<AgentNodeState>(['COMPLETE', 'FAILED', 'CANCELLED']);

export interface PresenceSatellite {
  /** Stable identity: the agent id, so a satellite can never be silently reassigned. */
  key: string;
  agentId: string;
  name: string;
  state: AgentNodeState;
  animated: boolean;
  angle: number;
  point: Point;
  jobId: string;
  jobCount: number;
  parentAgentId?: string;
}

/**
 * Genuine agent jobs, and only those. Terminal jobs leave the field immediately;
 * positions are derived from sorted identity so observation order can never
 * relocate an agent between frames or invent a transfer.
 */
export function presenceSatellites(jobs: ReadonlyArray<OperatingAgentJob>, options: {
  core: Point; radius: number; current: boolean; reducedMotion?: boolean; limit?: number;
}): PresenceSatellite[] {
  const field = agentField([...jobs], options.current, options.limit ?? 6);
  const active = field.nodes.filter(node => !TERMINAL_AGENT_STATES.has(node.state));
  const start = 196, sweep = 300;
  const step = active.length > 1 ? sweep / (active.length - 1) : 0;
  return active.map((node, index) => {
    const angle = active.length === 1 ? 268 : start + step * index;
    return {
      key: node.agentId, agentId: node.agentId, name: node.name, state: node.state,
      animated: !options.reducedMotion && node.animated,
      angle, point: polar(options.core, options.radius, angle),
      jobId: node.jobId, jobCount: node.jobCount,
      ...(node.parentAgentId ? { parentAgentId: node.parentAgentId } : {}),
    };
  });
}

/** Input affordances stay available while the Kernel is current and not synthetic. */
export function presenceInputEnabled(input: { liveness: DataLiveness }): boolean {
  return input.liveness.current && !input.liveness.synthetic;
}

/** Keyboard contract for the experience switch; documented here so it is testable. */
export const PRESENCE_MODE_KEY = 'p';
export const COMMAND_MODE_KEY = 'c';
export const PRESENCE_MODE_STORAGE = 'jarvis:mode:v1';
