import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, ShaderMaterial, Vector3 } from 'three';
import { COLOUR, type SemanticColour } from '../visual-tokens.ts';
import { DISC_FRAGMENT, DISC_VERTEX, RIBBON_FRAGMENT, RIBBON_VERTEX, RING_FRAGMENT, RING_VERTEX } from './glsl.ts';

export const colour = (name: SemanticColour) => new Color(COLOUR[name]);
const PALETTE = new Map<SemanticColour, Color>();
/** Shared read-only colour instances for per-frame lerps. Never mutate. */
export function palette(name: SemanticColour): Color {
  let value = PALETTE.get(name);
  if (!value) { value = new Color(COLOUR[name]); PALETTE.set(name, value); }
  return value;
}

const ribbons = new Map<number, BufferGeometry>();
/** Shared strip; shape comes entirely from per-material Bézier uniforms. */
export function ribbonGeometry(segments = 64): BufferGeometry {
  const cached = ribbons.get(segments);
  if (cached) return cached;
  const t = new Float32Array((segments + 1) * 2), side = new Float32Array((segments + 1) * 2), position = new Float32Array((segments + 1) * 6);
  const index: number[] = [];
  for (let i = 0; i <= segments; i++) {
    t[i * 2] = t[i * 2 + 1] = i / segments; side[i * 2] = -1; side[i * 2 + 1] = 1;
    if (i < segments) { const a = i * 2; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('aT', new BufferAttribute(t, 1));
  geometry.setAttribute('aSide', new BufferAttribute(side, 1));
  geometry.setIndex(index);
  geometry.boundingSphere = null;
  ribbons.set(segments, geometry);
  return geometry;
}

export type RibbonUniforms = {
  uP0: { value: Vector3 }; uP1: { value: Vector3 }; uP2: { value: Vector3 }; uWidth: { value: number };
  uColour: { value: Color }; uPulseColour: { value: Color }; uAlpha: { value: number }; uDraw: { value: number };
  uPulse: { value: number }; uPhase: { value: number }; uPulseCount: { value: number }; uBroken: { value: number };
  uDash: { value: number }; uHold: { value: number }; uFlicker: { value: number }; uTime: { value: number };
};
export function ribbonMaterial(): ShaderMaterial & { uniforms: RibbonUniforms } {
  const uniforms: RibbonUniforms = {
    uP0: { value: new Vector3() }, uP1: { value: new Vector3() }, uP2: { value: new Vector3() }, uWidth: { value: .01 },
    uColour: { value: colour('cognition') }, uPulseColour: { value: colour('ice') }, uAlpha: { value: 0 }, uDraw: { value: 0 },
    uPulse: { value: 0 }, uPhase: { value: 0 }, uPulseCount: { value: 3 }, uBroken: { value: 0 }, uDash: { value: 0 }, uHold: { value: 0 }, uFlicker: { value: 0 }, uTime: { value: 0 },
  };
  return new ShaderMaterial({ uniforms, vertexShader: RIBBON_VERTEX, fragmentShader: RIBBON_FRAGMENT, transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending }) as ShaderMaterial & { uniforms: RibbonUniforms };
}

export type DiscUniforms = { uColour: { value: Color }; uAlpha: { value: number }; uCore: { value: number }; uFalloff: { value: number } };
export function discMaterial(name: SemanticColour, falloff = 2.2, core = 0): ShaderMaterial & { uniforms: DiscUniforms } {
  const uniforms: DiscUniforms = { uColour: { value: colour(name) }, uAlpha: { value: 0 }, uCore: { value: core }, uFalloff: { value: falloff } };
  return new ShaderMaterial({ uniforms, vertexShader: DISC_VERTEX, fragmentShader: DISC_FRAGMENT, transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending }) as ShaderMaterial & { uniforms: DiscUniforms };
}

export type RingUniforms = {
  uColour: { value: Color }; uAccent: { value: Color }; uAlpha: { value: number }; uTicks: { value: number }; uTickAlpha: { value: number };
  uPackets: { value: number }; uPhase: { value: number }; uLobe: { value: number }; uLobeAlpha: { value: number }; uLobeWidth: { value: number };
  uArc: { value: number }; uArcStart: { value: number }; uGap: { value: number }; uInner: { value: number }; uOuter: { value: number };
  uWave: { value: number }; uWaveAmp: { value: number }; uTime: { value: number };
};
export function ringMaterial(inner: number, outer: number, options: Partial<{ colour: SemanticColour; accent: SemanticColour; ticks: number; tickAlpha: number; packets: number }> = {}): ShaderMaterial & { uniforms: RingUniforms } {
  const uniforms: RingUniforms = {
    uColour: { value: colour(options.colour ?? 'infra') }, uAccent: { value: colour(options.accent ?? 'ice') }, uAlpha: { value: 0 },
    uTicks: { value: options.ticks ?? 0 }, uTickAlpha: { value: options.tickAlpha ?? 0 }, uPackets: { value: options.packets ?? 0 }, uPhase: { value: 0 },
    uLobe: { value: 0 }, uLobeAlpha: { value: 0 }, uLobeWidth: { value: .3 }, uArc: { value: 1 }, uArcStart: { value: 0 }, uGap: { value: 0 },
    uInner: { value: inner }, uOuter: { value: outer }, uWave: { value: 0 }, uWaveAmp: { value: 0 }, uTime: { value: 0 },
  };
  return new ShaderMaterial({ uniforms, vertexShader: RING_VERTEX, fragmentShader: RING_FRAGMENT, transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending }) as ShaderMaterial & { uniforms: RingUniforms };
}
