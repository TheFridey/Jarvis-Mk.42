import type { ExperiencePhase } from './experience-phase-policy.ts';
import type { Point, SpatialLayout } from './spatial-layout-policy.ts';

/**
 * Subtle compositional framing, expressed in layout pixels so the GPU scene and
 * the DOM projections apply the identical transform: p' = s·(p − focus) + focus + bias.
 * No orbit, no pans; the largest shift is a small fraction of the viewport.
 */
export interface Framing { scale: number; focus: Point; bias: Point; /** Damping rate toward this framing, 1/s. */ rate: number }

export const MAX_FRAMING_SCALE = 1.03;
export const MAX_BIAS_FRACTION = .015;

const toward = (from: Point, to: Point, amount: number): Point => ({ x: (from.x - to.x) * amount, y: (from.y - to.y) * amount });

export function framingTarget(phase: ExperiencePhase, layout: SpatialLayout, reducedMotion: boolean): Framing {
  const identity: Framing = { scale: 1, focus: layout.core, bias: { x: 0, y: 0 }, rate: .9 };
  if (reducedMotion) return { ...identity, rate: Number.POSITIVE_INFINITY };
  const modelField = { x: layout.core.x + layout.modelRadius * .85, y: layout.core.y };
  let framing: Framing;
  switch (phase) {
    case 'LISTENING': case 'RESPONDING': framing = { ...identity, scale: 1.01, rate: 1.1 }; break;
    case 'INTERPRETING': case 'THINKING': framing = { ...identity, scale: 1.025, rate: 1 }; break;
    case 'ROUTING': case 'MODEL_ACTIVE': case 'FALLBACK': framing = { ...identity, scale: 1.02, bias: toward(layout.core, modelField, .07), rate: 1 }; break;
    case 'EXECUTING': framing = { ...identity, scale: 1.02, bias: toward(layout.core, layout.execution.anchor, .09), rate: 1 }; break;
    case 'APPROVAL': {
      const between = { x: (layout.core.x + layout.execution.barrier.x) / 2, y: (layout.core.y + layout.execution.barrier.y) / 2 };
      framing = { ...identity, scale: 1.015, focus: between, bias: toward(layout.core, between, .1), rate: .8 };
      break;
    }
    case 'VERIFYING': framing = { ...identity, scale: 1.01, rate: 1 }; break;
    case 'COMPLETE': framing = { ...identity, rate: .45 }; break;
    default: framing = identity;
  }
  const limit = layout.width * MAX_BIAS_FRACTION;
  const clamp = (value: number) => Math.max(-limit, Math.min(limit, value));
  const scale = Math.min(layout.narrow ? 1.01 : MAX_FRAMING_SCALE, framing.scale);
  return { ...framing, scale, bias: layout.narrow ? { x: 0, y: 0 } : { x: clamp(framing.bias.x), y: clamp(framing.bias.y) } };
}

/** CSS transform (origin 0 0) equivalent to the framing: translate(a, b) scale(s). */
export function framingTransform(framing: Pick<Framing, 'scale' | 'focus' | 'bias'>): { a: number; b: number; s: number } {
  const s = framing.scale;
  return { a: framing.focus.x * (1 - s) + framing.bias.x, b: framing.focus.y * (1 - s) + framing.bias.y, s };
}

export function applyFraming(point: Point, framing: Pick<Framing, 'scale' | 'focus' | 'bias'>): Point {
  const { a, b, s } = framingTransform(framing);
  return { x: point.x * s + a, y: point.y * s + b };
}
