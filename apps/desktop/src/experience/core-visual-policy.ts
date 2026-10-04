import type { InteractionState, JarvisOperatingPicture, WorkState } from '@jarvis/scene';
import type { ExperiencePhase } from './experience-phase-policy.ts';
import type { SemanticColour } from './visual-tokens.ts';

export interface CoreVisualPolicy {
  label: InteractionState | WorkState;
  cyan: number; gold: number; ember: number; waveform: number;
  compression: number; orbitSpeed: number; routeEnergy: number;
  scan: number; confirmation: number; incompleteOrbit: boolean; fracture: number;
}

export function coreVisualPolicy(picture?: JarvisOperatingPicture): CoreVisualPolicy {
  const interaction = picture?.interactionState ?? 'DORMANT';
  const work = picture?.workState ?? 'IDLE';
  const label: InteractionState | WorkState = work !== 'IDLE' ? work : interaction;
  const listening = interaction === 'LISTENING';
  const interpreting = interaction === 'INTERPRETING';
  const thinking = work === 'THINKING';
  const routing = work === 'ROUTING';
  const executing = work === 'EXECUTING';
  return {
    label,
    cyan: listening || interpreting || thinking || routing ? 1 : interaction === 'AWARE' ? .45 : .18,
    gold: executing ? 1 : work === 'COMPLETE' ? .72 : routing ? .48 : .14,
    ember: executing ? 1 : .22,
    waveform: listening || interaction === 'RESPONDING' ? 1 : 0,
    compression: interpreting ? 1 : 0,
    orbitSpeed: thinking ? 1 : routing ? .72 : .14,
    routeEnergy: routing ? 1 : 0,
    scan: work === 'VERIFYING' ? 1 : 0,
    confirmation: work === 'COMPLETE' ? 1 : 0,
    incompleteOrbit: work === 'BLOCKED',
    fracture: work === 'ERROR' ? 1 : 0,
  };
}

/**
 * GPU targets for the nested Core systems. The renderer damps toward these, so
 * a phase change is a transition (orbital expansion, convergence, decay), never
 * a pop. Values are 0..1 unless noted.
 */
export interface CoreSystemTargets {
  luminosity: number;
  colour: SemanticColour;
  /** Visible orbital data rings, 2..5 (fractional values fade the outermost). */
  rings: number;
  orbitSpeed: number;
  /** How far ring speeds diverge from each other (independent orbitals). */
  orbitIndependence: number;
  neural: number;
  shellExpansion: number;
  routing: number;
  forge: number;
  waveform: number;
  inflow: number;
  outflow: number;
  returnFlow: number;
  scan: number;
  convergence: number;
  asymmetry: number;
  fracture: number;
  barrier: number;
}

const BASE: CoreSystemTargets = { luminosity: .28, colour: 'infra', rings: 2, orbitSpeed: .12, orbitIndependence: .1, neural: .04, shellExpansion: 0, routing: 0, forge: .08, waveform: 0, inflow: 0, outflow: 0, returnFlow: 0, scan: 0, convergence: 0, asymmetry: 0, fracture: 0, barrier: 0 };

const PHASE: Record<ExperiencePhase, Partial<CoreSystemTargets>> = {
  UNAVAILABLE: { luminosity: .12, rings: 2, orbitSpeed: 0, neural: 0, forge: 0, asymmetry: .2 },
  COMM_LOSS: { luminosity: .16, colour: 'infra', rings: 2, orbitSpeed: .02, neural: 0, forge: .02, asymmetry: .35 },
  CRITICAL: { luminosity: .62, colour: 'critical', rings: 3, orbitSpeed: .3, orbitIndependence: .8, neural: .2, asymmetry: .8, fracture: 1 },
  DORMANT: {},
  AWARE: { luminosity: .38, colour: 'cognition', rings: 2.6, orbitSpeed: .2, neural: .12 },
  LISTENING: { luminosity: .56, colour: 'cognition', rings: 3, orbitSpeed: .28, neural: .25, waveform: 1, inflow: 1 },
  INTERPRETING: { luminosity: .66, colour: 'cognition', rings: 3.6, orbitSpeed: .55, orbitIndependence: .45, neural: .62, shellExpansion: .25, inflow: .45 },
  RESPONDING: { luminosity: .58, colour: 'cognition', rings: 3, orbitSpeed: .3, neural: .3, waveform: 1 },
  THINKING: { luminosity: .78, colour: 'cognition', rings: 4.4, orbitSpeed: 1, orbitIndependence: 1, neural: 1, shellExpansion: .85 },
  ROUTING: { luminosity: .82, colour: 'cognition', rings: 5, orbitSpeed: .8, orbitIndependence: .7, neural: .75, shellExpansion: .7, routing: 1 },
  MODEL_ACTIVE: { luminosity: .8, colour: 'cognition', rings: 4.6, orbitSpeed: .7, orbitIndependence: .6, neural: .85, shellExpansion: .6, routing: .7 },
  // Fallback is a route event: the failed route and fallback link carry amber, the Core keeps cognition colour.
  FALLBACK: { luminosity: .78, colour: 'cognition', rings: 4.4, orbitSpeed: .65, orbitIndependence: .85, neural: .6, shellExpansion: .55, routing: 1, asymmetry: .25 },
  APPROVAL: { luminosity: .6, colour: 'execution', rings: 3.4, orbitSpeed: .06, orbitIndependence: 0, neural: .1, forge: .7, barrier: 1 },
  EXECUTING: { luminosity: .9, colour: 'execution', rings: 4, orbitSpeed: .55, orbitIndependence: .3, neural: .3, forge: 1, outflow: 1 },
  VERIFYING: { luminosity: .72, colour: 'verified', rings: 3.6, orbitSpeed: .35, neural: .2, forge: .45, scan: 1, returnFlow: 1 },
  COMPLETE: { luminosity: .66, colour: 'verified', rings: 3, orbitSpeed: .18, neural: .1, forge: .5, convergence: 1 },
  WAITING: { luminosity: .42, colour: 'infra', rings: 3, orbitSpeed: .1, neural: .1 },
  BLOCKED: { luminosity: .5, colour: 'degraded', rings: 3, orbitSpeed: .14, asymmetry: .55 },
  ERROR: { luminosity: .55, colour: 'degraded', rings: 3, orbitSpeed: .2, orbitIndependence: .6, asymmetry: .6, fracture: .45 },
  // Degradation stays local to its region: the Core loses symmetry, it is not repainted amber.
  DEGRADED: { luminosity: .34, colour: 'infra', rings: 2.4, orbitSpeed: .14, orbitIndependence: .4, asymmetry: .55 },
};

/** `systemDegraded` overlays asymmetry on any active phase without repainting it. */
export function coreSystemTargets(phase: ExperiencePhase, systemDegraded = false): CoreSystemTargets {
  const targets = { ...BASE, ...PHASE[phase] };
  if (systemDegraded && phase !== 'CRITICAL') targets.asymmetry = Math.max(targets.asymmetry, .4);
  return targets;
}
