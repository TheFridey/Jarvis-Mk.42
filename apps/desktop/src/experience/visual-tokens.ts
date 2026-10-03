/**
 * OBSIDIAN FORGE semantic visual tokens. The single source for colour, motion,
 * depth and energy in both the GPU scene and the DOM. `app/globals.css`
 * mirrors the colour and motion tokens as custom properties; the token test
 * keeps the two in step. Artistic geometry is never telemetry.
 */
export const COLOUR = {
  obsidian0: '#010203', obsidian1: '#04070a', obsidian2: '#080d12', graphite: '#11171d', graphiteLine: '#1d262e',
  cognition: '#5fd8f2', cognitionDeep: '#1b6f8a', ice: '#c9f3ff',
  execution: '#e9a63c', ember: '#b45d1c', forge: '#ffcc7a',
  infra: '#a9b4bd', platinum: '#dfe6ea', silverDim: '#5b6670',
  verified: '#6fe3c1', verifiedDeep: '#1f7a63',
  degraded: '#e3a04a', degradedDeep: '#7a4a14',
  critical: '#ff5a48', criticalDeep: '#7a1710',
  ink: '#e3eaee', inkMuted: '#8a969f', inkFaint: '#56616a',
} as const;
export type SemanticColour = keyof typeof COLOUR;

export const ALPHA = { line: .16, lineStrong: .34, grid: .05, panel: .62, panelDense: .86, glowSoft: .18, glowStrong: .55 } as const;

/** Seconds. Deliberate, physically damped motion; no spring overshoot. */
export const MOTION = {
  instant: 0, quick: .18, settle: .42, unfold: .9, converge: 1.6, decay: 2.4, freeze: 8,
  /** Exponential damping rates (1/s) for GPU interpolation toward policy targets. */
  dampFast: 6, dampSettle: 2.4, dampSlow: .9,
} as const;
export const EASE = { settle: 'cubic-bezier(.2,.7,.2,1)', unfold: 'cubic-bezier(.16,.84,.24,1)', decay: 'cubic-bezier(.4,0,.6,1)' } as const;

export const DEPTH = { nebula: -24, stars: -12, field: -3, core: 0, connections: .05, nodes: .1 } as const;

export const TYPE = { data: '"DM Mono", ui-monospace, "Cascadia Mono", Consolas, monospace', body: 'Manrope, "Segoe UI", system-ui, sans-serif' } as const;

export function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}
