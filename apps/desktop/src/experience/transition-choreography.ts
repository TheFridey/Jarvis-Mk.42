import type { ModelNode, RouteObservation } from './cognition-router-policy.ts';

/**
 * Presentation-only transition coordinator. It never owns, delays or rewrites
 * Kernel state: it records when an observed route change was *received* and
 * returns interpolation envelopes for the renderer between the previous and the
 * new observation. Text and accessibility state update immediately; only the
 * GPU choreography follows this timeline. Reduced motion collapses every
 * envelope to its settled value.
 */
export type TransitionKind = 'acquire' | 'switch' | 'fallback' | 'result';
type Locality = 'local' | 'cloud-ok' | undefined;

export interface RouteSnapshot {
  requestId?: string;
  current: boolean;
  selectedModelId?: string;
  fallback: boolean;
  failedIds: string[];
  /** Observed candidates of the current run, excluding the selection. */
  candidateIds: string[];
  localities: Record<string, Locality>;
}

export interface ModelTransition {
  id: number;
  kind: TransitionKind;
  from?: string;
  to?: string;
  candidates: string[];
  startedAt: number;
  crossesBoundary: boolean;
}

export interface ChoreographyState { last?: RouteSnapshot; transitions: ModelTransition[]; seq: number }
export const emptyChoreography = (): ChoreographyState => ({ transitions: [], seq: 0 });

/** Milliseconds from the observed change; windows overlap deliberately. */
export const TIMELINE = {
  decay: [0, 250], wake: [150, 450], branch: [300, 700], lock: [550, 950], result: [700, 1200], historical: [900, 1500],
  fracture: [0, 450], crossing: [300, 1200], returnFlow: [0, 1200],
} as const satisfies Record<string, readonly [number, number]>;
export const TRANSITION_SPAN_MS = 1600;

export function routeSnapshot(route: RouteObservation | undefined, nodes: ModelNode[]): RouteSnapshot {
  const current = Boolean(route?.current);
  const selected = current ? route?.selectedModelId : undefined;
  return {
    ...(route?.requestId ? { requestId: route.requestId } : {}),
    current,
    ...(selected ? { selectedModelId: selected } : {}),
    fallback: current && Boolean(route?.fallback),
    failedIds: current ? route?.failedIds ?? [] : [],
    candidateIds: current ? nodes.filter(node => node.modelId !== selected && ['CANDIDATE', 'REJECTED', 'FALLBACK'].includes(node.route)).map(node => node.modelId) : [],
    localities: Object.fromEntries(nodes.map(node => [node.modelId, node.locality])),
  };
}

const sameSnapshot = (a: RouteSnapshot | undefined, b: RouteSnapshot) => Boolean(a) && a!.requestId === b.requestId && a!.current === b.current && a!.selectedModelId === b.selectedModelId && a!.fallback === b.fallback && a!.failedIds.join() === b.failedIds.join();

/** Record a newly received observation. `at` is local receipt time (ms). */
export function observeRoute(state: ChoreographyState, next: RouteSnapshot, at: number): ChoreographyState {
  if (sameSnapshot(state.last, next)) return { ...state, last: next };
  const prev = state.last;
  const transitions = state.transitions.filter(item => at - item.startedAt < TRANSITION_SPAN_MS);
  let seq = state.seq;
  const add = (kind: TransitionKind, from: string | undefined, to: string | undefined) => {
    const localityFrom = from ? next.localities[from] ?? prev?.localities[from] : undefined;
    const localityTo = to ? next.localities[to] : undefined;
    transitions.push({ id: ++seq, kind, ...(from ? { from } : {}), ...(to ? { to } : {}), candidates: next.candidateIds, startedAt: at, crossesBoundary: Boolean(localityFrom && localityTo && localityFrom !== localityTo) });
  };
  const before = prev?.current ? prev.selectedModelId : undefined;
  const after = next.selectedModelId;
  if (next.fallback && (!prev?.fallback || before !== after) && after) add('fallback', next.failedIds[0] ?? before, after);
  else if (after && before && after !== before) add('switch', before, after);
  else if (after && !before) add('acquire', undefined, after);
  else if (!after && before && !next.current && prev?.requestId === next.requestId) add('result', before, undefined);
  return { last: next, transitions, seq };
}

const smooth = (x: number) => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
/** 0 before the window, 1 after it, smoothstep inside. */
export function windowProgress(elapsed: number, [start, end]: readonly [number, number]): number {
  return smooth((elapsed - start) / Math.max(1, end - start));
}

export interface ModelChoreography {
  /** Previous selection's appearance retained (1) until it becomes historical (0). */
  retain: number;
  /** Inference energy of the previous selection; decays first. */
  energy: number;
  /** New selection's route lock: 0 = still a candidate, 1 = locked. */
  lock: number;
  /** New selection's inference pulse, admitted once the route has locked. */
  pulse: number;
  /** Candidate pathways branching from the Core, a rise-and-dissolve hump. */
  branch: number;
  /** Candidate constellation waking. */
  wake: number;
  /** Failed primary route losing coherence. */
  fracture: number;
  /** Result energy travelling back to the Core along this link, 0..1 progress (undefined when idle). */
  returnProgress?: number;
}

const SETTLED: ModelChoreography = { retain: 0, energy: 0, lock: 1, pulse: 1, branch: 0, wake: 0, fracture: 1 };

/** Envelope for one model at `now`. Unaffected models return the settled values. */
export function modelChoreography(state: ChoreographyState, modelId: string, now: number, reduced: boolean): ModelChoreography {
  if (reduced) return SETTLED;
  const out: ModelChoreography = { ...SETTLED };
  for (const item of state.transitions) {
    const t = now - item.startedAt;
    if (t < 0 || t >= TRANSITION_SPAN_MS) continue;
    if (item.to === modelId) { out.lock = Math.min(out.lock, windowProgress(t, TIMELINE.lock)); out.pulse = Math.min(out.pulse, windowProgress(t, TIMELINE.result)); }
    if (item.from === modelId) {
      if (item.kind === 'fallback') out.fracture = Math.min(out.fracture, windowProgress(t, TIMELINE.fracture));
      else if (item.kind === 'result') { out.retain = Math.max(out.retain, 1 - windowProgress(t, TIMELINE.result)); out.returnProgress = windowProgress(t, TIMELINE.returnFlow); }
      else { out.retain = Math.max(out.retain, 1 - windowProgress(t, TIMELINE.historical)); out.energy = Math.max(out.energy, 1 - windowProgress(t, TIMELINE.decay)); }
    }
    if (item.candidates.includes(modelId) && item.kind !== 'result') {
      out.wake = Math.max(out.wake, windowProgress(t, TIMELINE.wake) * (1 - windowProgress(t, TIMELINE.historical)));
      out.branch = Math.max(out.branch, windowProgress(t, TIMELINE.branch) * (1 - windowProgress(t, TIMELINE.lock)));
    }
  }
  return out;
}

export interface SceneChoreography {
  /** Locality crossing pulse: from -> boundary -> to, progress 0..1. */
  crossing?: { from: string; to: string; progress: number };
  /** Result pulse arriving at the Core, 0..1 hump. */
  coreReturn: number;
}

export function sceneChoreography(state: ChoreographyState, now: number, reduced: boolean): SceneChoreography {
  if (reduced) return { coreReturn: 0 };
  let crossing: SceneChoreography['crossing'];
  let coreReturn = 0;
  for (const item of state.transitions) {
    const t = now - item.startedAt;
    if (t < 0 || t >= TRANSITION_SPAN_MS) continue;
    if (item.crossesBoundary && item.from && item.to) {
      const progress = windowProgress(t, TIMELINE.crossing);
      if (progress > 0 && progress < 1) crossing = { from: item.from, to: item.to, progress };
    }
    if (item.kind === 'result') coreReturn = Math.max(coreReturn, Math.sin(Math.PI * windowProgress(t, TIMELINE.result)));
  }
  return { ...(crossing ? { crossing } : {}), coreReturn };
}

export function activeTransitions(state: ChoreographyState, now: number): ModelTransition[] {
  return state.transitions.filter(item => now - item.startedAt >= 0 && now - item.startedAt < TRANSITION_SPAN_MS);
}
