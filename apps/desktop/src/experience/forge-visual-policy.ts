import type { JarvisOperatingPicture, PresentationState, SemanticScene } from '@jarvis/scene';

export type ForgeQuality = 'AUTO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'ULTRA';
export type ResolvedForgeQuality = Exclude<ForgeQuality, 'AUTO'>;
export type ForgeVisualState = 'IDLE' | 'REASONING' | 'ROUTING' | 'EXECUTION' | 'VERIFICATION' | 'DEGRADED' | 'CRITICAL';

export interface ForgeVisualPolicy {
  state: ForgeVisualState;
  quality: ResolvedForgeQuality;
  particleCount: number;
  starCount: number;
  neuralCount: number;
  emberCount: number;
  fluxCount: number;
  nebulaOctaves: number;
  coreSegments: number;
  maxFps: number;
  dpr: [number, number];
  bloom: boolean;
  motion: number;
  cyanEnergy: number;
  goldEnergy: number;
  amberDisruption: number;
  redDisruption: number;
}

type Budget = Pick<ForgeVisualPolicy, 'particleCount'|'starCount'|'neuralCount'|'emberCount'|'fluxCount'|'nebulaOctaves'|'coreSegments'|'maxFps'|'dpr'|'bloom'>;
/** LOW is designed for integrated GPUs: one nebula pass, no bloom, sparse field. */
const BUDGETS: Record<ResolvedForgeQuality, Budget> = {
  LOW: { particleCount: 180, starCount: 260, neuralCount: 24, emberCount: 40, fluxCount: 120, nebulaOctaves: 2, coreSegments: 64, maxFps: 30, dpr: [0.75, 1], bloom: false },
  MEDIUM: { particleCount: 360, starCount: 520, neuralCount: 42, emberCount: 90, fluxCount: 260, nebulaOctaves: 3, coreSegments: 96, maxFps: 45, dpr: [0.85, 1.25], bloom: true },
  HIGH: { particleCount: 680, starCount: 900, neuralCount: 68, emberCount: 160, fluxCount: 480, nebulaOctaves: 4, coreSegments: 128, maxFps: 60, dpr: [1, 1.6], bloom: true },
  ULTRA: { particleCount: 1100, starCount: 1500, neuralCount: 96, emberCount: 260, fluxCount: 800, nebulaOctaves: 5, coreSegments: 192, maxFps: 60, dpr: [1, 2], bloom: true },
};

export function resolveVisualState(picture: JarvisOperatingPicture | undefined, presentation: PresentationState): ForgeVisualState {
  if (picture?.systemHealth.overall === 'OFFLINE') return 'CRITICAL';
  if (presentation === 'DEGRADED' || picture?.systemHealth.overall === 'DEGRADED') return 'DEGRADED';
  if (picture?.workState === 'VERIFYING') return 'VERIFICATION';
  if (picture?.workState === 'EXECUTING' || presentation === 'WORKING') return 'EXECUTION';
  if (picture?.workState === 'ROUTING') return 'ROUTING';
  if (picture?.workState === 'THINKING' || picture?.interactionState === 'INTERPRETING' || presentation === 'THINKING') return 'REASONING';
  return 'IDLE';
}

export function resolveQuality(setting: ForgeQuality, measuredTier: ResolvedForgeQuality, reducedMotion: boolean, lowPower: boolean): ResolvedForgeQuality {
  if (reducedMotion || lowPower) return setting === 'LOW' ? 'LOW' : 'MEDIUM';
  return setting === 'AUTO' ? measuredTier : setting;
}

export function visualPolicy(input: { picture?: JarvisOperatingPicture; scene: SemanticScene; setting: ForgeQuality; measuredTier: ResolvedForgeQuality; reducedMotion: boolean; lowPower: boolean; disconnected?:boolean }): ForgeVisualPolicy {
  const state = input.disconnected ? 'DEGRADED' : resolveVisualState(input.picture, input.scene.presentation);
  const quality = resolveQuality(input.setting, input.measuredTier, input.reducedMotion, input.lowPower);
  const base = BUDGETS[quality];
  const motion = input.reducedMotion ? 0 : input.lowPower ? 0.18 : state === 'IDLE' ? 0.12 : state === 'DEGRADED' ? 0.35 : 1;
  return {
    state, quality, ...base,
    maxFps: input.reducedMotion ? 1 : input.lowPower ? Math.min(base.maxFps, 15) : state === 'IDLE' ? Math.min(base.maxFps, 12) : base.maxFps,
    bloom: base.bloom && !input.reducedMotion && !input.lowPower,
    motion,
    cyanEnergy: state === 'REASONING' ? 1 : state === 'ROUTING' ? .72 : .16,
    goldEnergy: state === 'EXECUTION' ? 1 : state === 'ROUTING' ? .55 : state === 'VERIFICATION' ? .4 : .12,
    amberDisruption: state === 'DEGRADED' ? .7 : 0,
    redDisruption: state === 'CRITICAL' ? .72 : 0,
  };
}

export function seededUnit(seed: number, index: number): number {
  let value = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
  return (value >>> 0) / 0xffffffff;
}

export function nextMeasuredTier(current: ResolvedForgeQuality, averageFps: number): ResolvedForgeQuality {
  const order: ResolvedForgeQuality[] = ['LOW','MEDIUM','HIGH','ULTRA'];
  const index = order.indexOf(current);
  if (averageFps < 42) return order[Math.max(0,index-1)]!;
  if (averageFps > 57) return order[Math.min(order.length-1,index+1)]!;
  return current;
}
