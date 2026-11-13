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
import { latestFailure, type ExperiencePhase, type DataLiveness } from '../experience-phase-policy.ts';
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
  /**
   * Durable capability history. The only canonical evidence that an effect was
   * verified: `workState` never carries COMPLETE from the desktop gateway, so
   * completion must be read from these invocation states, never inferred.
   */
  capabilityActivity?: ReadonlyArray<{ action?: string; state: string; updatedAt?: string }>;
  agentJobs?: ReadonlyArray<OperatingAgentJob>;
  voiceAudio?: { tts?: string; observedAt?: string; amplitude?: number; playbackAmplitude?: number; deviceState?: 'ready' | 'lost' | 'recovering'; vad?: 'speech' | 'silence' | 'unknown' };
  systemHealth?: { overall?: string };
  systemMode?: string;
}

export interface PresenceInput {
  phase: ExperiencePhase;
  liveness: DataLiveness;
  picture?: PresencePicture | undefined;
  /** Wall clock for observation freshness. Defaults to Date.now(). */
  now?: number;
}

/** A TTS observation older than this cannot keep claiming speech. */
export const VOICE_OBSERVATION_FRESH_MS = 3000;
/** A verified invocation is recent history, not a permanent badge. */
export const VERIFIED_EVIDENCE_WINDOW_MS = 10 * 60 * 1000;

const VERIFIED_STATES = new Set(['VERIFIED', 'SUCCEEDED', 'COMPLETED', 'PARTIALLY_COMPLETED']);
const ACTIVE_STATES = new Set(['PROPOSED', 'VALIDATED', 'POLICY_CHECKED', 'APPROVED', 'SIMULATING', 'SIMULATED', 'LEASE_ACQUIRED', 'EXECUTING', 'VERIFYING']);
const FAILED_STATES = new Set(['FAILED', 'ABORTED', 'INTERRUPTED', 'CANCELLED', 'VERIFICATION_FAILED', 'UNVERIFIED', 'REJECTED', 'DENIED', 'EXPIRED']);

/** Genuine, fresh speech playback. Stale projections never imply audio. */
export function speechObserved(picture: PresencePicture | undefined, now = Date.now()): boolean {
  const audio = picture?.voiceAudio;
  if (audio?.tts !== 'playing') return false;
  if (!audio.observedAt) return false;
  const at = Date.parse(audio.observedAt);
  return Number.isFinite(at) && now - at <= VOICE_OBSERVATION_FRESH_MS;
}

/**
 * Canonical completion evidence. `capabilityActivity` is the authoritative
 * invocation ledger; agent prose and model output are never consulted here.
 */
export function verifiedEvidence(picture: PresencePicture | undefined, now = Date.now()): { verified: boolean; action?: string } {
  const activity = picture?.capabilityActivity ?? [];
  if (!activity.length) return { verified: false };
  // The projection carries one row per observed invocation state, so an action
  // appears several times as it advances. Its *latest* state is the observation;
  // an earlier EXECUTING row is history, not an active invocation.
  const latest = new Map<string, { state: string; action?: string; updatedAt?: string }>();
  for (const entry of activity) latest.set(entry.action ?? `invocation:${latest.size}`, entry);
  const states = [...latest.values()];
  if (states.some(entry => ACTIVE_STATES.has(entry.state))) return { verified: false };
  if (states.some(entry => FAILED_STATES.has(entry.state))) return { verified: false };
  const verified = states.filter(entry => VERIFIED_STATES.has(entry.state)).at(-1);
  if (!verified) return { verified: false };
  // Success is history the moment it stops being recent: without a timestamp we
  // cannot claim it is current, so we do not claim it at all.
  const at = verified.updatedAt ? Date.parse(verified.updatedAt) : Number.NaN;
  if (!Number.isFinite(at) || now - at > VERIFIED_EVIDENCE_WINDOW_MS) return { verified: false };
  return { verified: true, ...(verified.action ? { action: verified.action } : {}) };
}

/**
 * Deterministic precedence, highest first:
 *   1. DISCONNECTED — no current observation; nothing downstream may claim activity.
 *   2. FAULT        — authoritative critical health, work error, or blocked work.
 *   3. APPROVAL     — an operator decision is outstanding; it outranks activity
 *                     because it is the only state that needs the human.
 *   4. EXECUTING    — real capability work (EXECUTING/VERIFYING).
 *   5. VERIFIED     — completion, only with canonical evidence: the phase says
 *                     COMPLETE, or the invocation ledger carries a successful
 *                     terminal state with no active or later-failed invocation.
 *                     `workState` never carries COMPLETE from the desktop
 *                     gateway, so a bare 'nothing is happening' can never
 *                     become VERIFIED.
 *   6. SPEAKING     — a *fresh* TTS playback observation, or the phase RESPONDING
 *                     while such an observation exists. RESPONDING alone is not
 *                     audible speech.
 *   7. LISTENING / THINKING / STANDBY — remaining interaction and idle states.
 */
export function resolvePresenceState(input: PresenceInput): PresenceState {
  const { phase, liveness, picture, now = Date.now() } = input;
  if (!liveness.current) return 'DISCONNECTED';
  if (phase === 'CRITICAL' || phase === 'ERROR' || phase === 'BLOCKED') return 'FAULT';
  const approvals = picture?.pendingApprovals?.length ?? 0;
  if (approvals > 0 || phase === 'APPROVAL') return 'APPROVAL';
  if (phase === 'EXECUTING' || phase === 'VERIFYING') return 'EXECUTING';
  if (phase === 'COMPLETE') return 'VERIFIED';
  if (verifiedEvidence(picture, now).verified) return 'VERIFIED';
  if (speechObserved(picture, now)) return 'SPEAKING';
  return PHASE_STATE[phase];
}

export function presenceTone(state: PresenceState): PresenceTone {
  return TONE[state];
}

/**
 * The single word the orb carries. Words stay truthful at the boundaries where a
 * state is broader than one meaning: RESPONDING without audio is not SPEAKING,
 * and a degraded system is never silently called healthy.
 */
export function presenceWord(state: PresenceState, liveness: Pick<DataLiveness, 'status'>, nuance?: { responding?: boolean; degraded?: boolean }): string {
  if (state === 'DISCONNECTED') return liveness.status === 'reconnecting' || liveness.status === 'stale' ? 'STALE' : 'DISCONNECTED';
  if (state === 'SPEAKING' && nuance?.responding) return 'RESPONDING';
  if (state === 'STANDBY' && nuance?.degraded) return 'DEGRADED';
  return WORD[state];
}

/**
 * One short, truthful line. It states only what the projection carries; when a
 * signal is absent the line says so rather than filling the gap.
 */
export function presenceDetail(input: PresenceInput): string {
  const { phase, liveness, picture, now = Date.now() } = input;
  const state = resolvePresenceState(input);
  if (state === 'DISCONNECTED') return liveness.staleSince === undefined ? 'No authoritative state is being shown.' : `Last observation ${formatAge(now - liveness.staleSince)}. Decisions are unavailable.`;
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
  if (state === 'VERIFIED') {
    const evidence = verifiedEvidence(picture, now);
    return evidence.action ? `${evidence.action} verified. No further action is outstanding.` : 'Effect verified. No further action is outstanding.';
  }
  if (state === 'SPEAKING') return speechObserved(picture, now) ? 'Speaking.' : 'Response in progress.';
  if (state === 'LISTENING') return 'Capturing input.';
  if (state === 'THINKING') return phase === 'ROUTING' ? 'Selecting a route.' : 'Reasoning.';
  const agents = picture?.agentJobs?.filter(job => !TERMINAL_JOB_STATES.has(job.state)).length ?? 0;
  if (agents > 0) return `${agents} agent job${agents === 1 ? '' : 's'} in flight.`;
  if (phase === 'DEGRADED' || picture?.systemHealth?.overall === 'DEGRADED') return 'Subsystem health degraded. Availability is reduced.';
  const past = latestFailure(picture, now);
  if (past) {
    const when = past.ageMs === undefined ? 'at an unknown time' : `at ${new Date((past.at ? Date.parse(past.at) : now - (past.ageMs ?? 0))).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    return `Standing by. Last work fault: ${past.action ? `${past.action} · ` : ''}${past.state} ${when}.`;
  }
  return liveness.synthetic ? 'Synthetic data. No live execution.' : 'Standing by.';
}

export interface PresenceReadout {
  state: PresenceState;
  word: string;
  detail: string;
  tone: PresenceTone;
  /** True only when fresh TTS playback is observed. */
  speaking: boolean;
  /** True when the system reports its own degradation. */
  degraded: boolean;
}

/**
 * One derivation used by the DOM and the GPU so a frame can never disagree with
 * its own text: the same input produces the same state, word, tone and sentence.
 */
export function presenceReadout(input: PresenceInput): PresenceReadout {
  const now = input.now ?? Date.now();
  const state = resolvePresenceState({ ...input, now });
  const speaking = speechObserved(input.picture, now);
  const degraded = input.phase === 'DEGRADED' || input.picture?.systemHealth?.overall === 'DEGRADED';
  const responding = state === 'SPEAKING' && !speaking;
  return {
    state,
    word: presenceWord(state, input.liveness, { responding, degraded }),
    detail: presenceDetail({ ...input, now }),
    tone: degraded && state === 'STANDBY' ? 'attention' : presenceTone(state),
    speaking,
    degraded,
  };
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
  // 1100 is the same breakpoint at which the response column stops existing, so
  // the orb is always sized for the layout that will actually be used.
  const narrow = width < 1100 || height < 620;
  const base = spatialLayout({ width, height, models: [], agentCount: 0 });
  const desired = narrow ? Math.min(width * .3, height * .2) : Math.min(height * .335, width * .235);
  const core: Point = { x: width * .5, y: height * (narrow ? .4 : .43) };
  // The orb must leave room for the whole readout and response stack below it.
  // On a wide screen the response has its own column, so the orb only has to
  // clear the word and the detail line; in the stacked layout it must also leave
  // a usable reading surface above the input.
  const docked = !narrow;
  // The detail line may wrap to two lines with a long fault history, so the
  // reserved band is two lines, not one.
  const edge = narrow ? 12 : 24, inputHeight = narrow ? 48 : 52, footer = 30, detail = 74, gap = 10, answerMin = docked ? 0 : 140;
  const inputTop = height - edge - footer - inputHeight;
  const maxHorizon = inputTop - 14 - answerMin - detail - gap;
  const coreRadius = Math.max(96, Math.min(desired, (maxHorizon - core.y) / 1.1));
  // Upper arc only, and never wider than the frame: the lower half belongs to
  // the word, the response and the input, and a satellite must not sit on them.
  const satelliteRadius = Math.min(coreRadius * 1.5, Math.max(120, core.y - coreRadius * .55), width * .42);
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
  const start = 22, sweep = 136;
  const step = active.length > 1 ? sweep / (active.length - 1) : 0;
  return active.map((node, index) => {
    const angle = active.length === 1 ? 90 : start + step * index;
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

/* ------------------------------------------------------------- vertical zones */

export interface PresenceZones {
  /** Top edge of the word block. */
  horizon: number;
  /** Bottom edge of the detail line. */
  detailBottom: number;
  /** Top edge of a response surface; it can never cross this upward. */
  answerTop: number;
  answerMaxHeight: number;
  /** Wide screens dock the response beside the orb; narrow ones stack it. */
  answerDocked: boolean;
  inputTop: number;
  inputBottom: number;
}

/**
 * One deterministic vertical stack, so nothing can overlap: orb → word →
 * detail → response → input. The response surface grows upward into whatever
 * space is left and scrolls beyond it; it never covers the word or the input.
 * Pure arithmetic, so the guarantee is testable without a browser.
 */
export function presenceZones(viewport: { width: number; height: number }, composition: PresenceComposition): PresenceZones {
  const height = Math.max(320, viewport.height);
  const narrow = composition.layout.narrow;
  const edge = narrow ? 12 : 24;
  const inputHeight = narrow ? 48 : 52;
  const footer = 30;
  const inputBottom = height - edge - footer;
  const inputTop = inputBottom - inputHeight;
  const detailBottom = composition.horizon + 74;
  const answerTop = detailBottom + 10;
  // On a wide screen the response lives in its own column beside the orb, so it
  // may be tall. Below 1100px there is no column, so it is bounded by the space
  // between the readout and the input and scrolls inside it.
  const answerDocked = viewport.width >= 1100;
  return {
    horizon: composition.horizon,
    detailBottom,
    answerTop,
    answerDocked,
    answerMaxHeight: answerDocked ? Math.max(180, Math.round(height * .46)) : Math.max(64, inputTop - 14 - answerTop),
    inputTop,
    inputBottom,
  };
}

/* --------------------------------------------------------------------- voice */

export type PresenceVoiceState = 'OFF' | 'READY' | 'LIVE' | 'DEGRADED' | 'UNAVAILABLE';

export interface PresenceVoiceStatus {
  state: PresenceVoiceState;
  label: string;
  detail: string;
}

/**
 * Microphone affordance state. It reports the transport and the Kernel's own
 * device observation — never a fabricated capture. Starting requires an explicit
 * gesture; nothing here listens on its own.
 */
export function presenceVoiceStatus(input: {
  liveness: DataLiveness; micActive: boolean; available: boolean; picture?: PresencePicture | undefined;
}): PresenceVoiceStatus {
  const device = input.picture?.voiceAudio?.deviceState;
  if (!input.liveness.current) return { state: 'UNAVAILABLE', label: 'VOICE UNAVAILABLE', detail: 'Microphone unavailable while the Kernel is disconnected.' };
  if (!input.available) return { state: 'UNAVAILABLE', label: 'VOICE UNAVAILABLE', detail: 'The RTC service is not ready.' };
  if (input.micActive) return { state: 'LIVE', label: 'MIC LIVE', detail: 'Microphone is published to the private session. Stop to release it.' };
  if (device === 'lost' || device === 'recovering') return { state: 'DEGRADED', label: 'MIC DEGRADED', detail: `Voice device ${device}. Capture may be unavailable.` };
  return { state: 'READY', label: 'VOICE', detail: 'Start a private audio session. The microphone is not captured until you press it.' };
}

/** Keyboard contract for the experience switch; documented here so it is testable. */
export const PRESENCE_MODE_KEY = 'p';
export const COMMAND_MODE_KEY = 'c';
export const PRESENCE_MODE_STORAGE = 'jarvis:mode:v1';
