import type { InteractionState, JarvisOperatingPicture, WorkState } from '@jarvis/scene';

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
