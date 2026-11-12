'use client';
/**
 * Presence atmosphere: the one renderer component SENTIENCE adds.
 *
 * Why a new component and not a reuse: the command-centre composition budgets
 * its depth for a constellation of models, agents and a lifecycle path, so its
 * dust sits at moderate spread and its halo is tuned for a smaller core. Presence
 * removes all of that structure and needs depth *behind* a much larger sphere —
 * three parallax dust shells, a wide low-frequency halo and two slow rim rings —
 * none of which the command centre should ever draw, because it would imply a
 * spatial field it does not have.
 *
 * It composes the existing primitives only (`DriftField`, `discMaterial`,
 * `ringMaterial`, the shared clock and damping). It adds no new shader, no new
 * geometry family and no new state: colour and energy are derived from the same
 * presence state the DOM is showing.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Mesh } from 'three';
import { DriftField } from './particle-fields.tsx';
import { colour, discMaterial, ringMaterial } from './primitives.ts';
import { damp } from './damp.ts';
import { rate, useCosmosClock } from './runtime.tsx';
import type { SemanticColour } from '../visual-tokens.ts';
import type { PresenceState } from '../presence/presence-policy.ts';

const ACCENT: Record<PresenceState, SemanticColour> = {
  DISCONNECTED: 'silverDim', FAULT: 'critical', APPROVAL: 'forge', EXECUTING: 'execution',
  VERIFIED: 'verified', SPEAKING: 'cognition', LISTENING: 'cognition', THINKING: 'cognition', STANDBY: 'infra',
};

/** How much light the atmosphere carries per state, 0..1. Never state-bearing by itself. */
const ENERGY: Record<PresenceState, number> = {
  DISCONNECTED: .18, FAULT: .34, APPROVAL: .3, EXECUTING: .82,
  VERIFIED: .5, SPEAKING: .6, LISTENING: .45, THINKING: .72, STANDBY: .28,
};

export function PresenceAtmosphere({ core, radius, state, ambient, dust, reduced, active = true }: {
  core: [number, number]; radius: number; state: PresenceState;
  ambient: number; dust: number; reduced: boolean;
  /** Kept mounted across modes so switching never recompiles shaders. */
  active?: boolean;
}) {
  const clock = useCosmosClock();
  const halo = useRef<Mesh>(null), innerRing = useRef<Mesh>(null), outerRing = useRef<Mesh>(null);
  const level = useRef(0);

  const m = useMemo(() => ({
    halo: discMaterial('cognitionDeep', 2.6, .18),
    innerRing: ringMaterial(.995, 1, { ticks: 96, tickAlpha: .16, packets: 4, colour: 'ice', accent: 'cognition' }),
    outerRing: ringMaterial(.998, 1, { ticks: 24, tickAlpha: .1, packets: 2, colour: 'infra', accent: 'ice' }),
  }), []);
  useEffect(() => () => { [m.halo, m.innerRing, m.outerRing].forEach(material => material.dispose()); }, [m]);

  const accent = ACCENT[state];
  useEffect(() => {
    m.innerRing.uniforms.uColour.value.copy(colour(accent));
    m.outerRing.uniforms.uAccent.value.copy(colour(accent));
    m.halo.uniforms.uColour.value.copy(colour(accent));
  }, [m, accent]);

  useFrame(() => {
    const dt = clock.dt;
    const settle = rate(clock, .55), spin = rate(clock, .12);
    const target = ENERGY[state] * (.65 + ambient * .35);
    level.current = damp(level.current, target, settle, dt);
    m.halo.uniforms.uAlpha.value = level.current * .22;
    m.innerRing.uniforms.uAlpha.value = level.current * .5;
    m.outerRing.uniforms.uAlpha.value = level.current * .3;
    m.innerRing.uniforms.uPhase.value = damp(m.innerRing.uniforms.uPhase.value, clock.t * .06, spin, dt);
    m.outerRing.uniforms.uPhase.value = damp(m.outerRing.uniforms.uPhase.value, -clock.t * .032, spin, dt);
    m.innerRing.uniforms.uTime.value = clock.t;
    m.outerRing.uniforms.uTime.value = clock.t;
    if (halo.current) halo.current.scale.setScalar(1 + level.current * .045 + Math.sin(clock.t * .35) * .008 * (1 - Number(reduced)));
    if (innerRing.current) innerRing.current.rotation.z = clock.t * .018 * (reduced ? 0 : 1);
    if (outerRing.current) outerRing.current.rotation.z = -clock.t * .009 * (reduced ? 0 : 1);
  });

  const shellsBase = Math.max(120, Math.floor(dust / 3));
  return <group position={[core[0], core[1], 0]} visible={active}>
    <mesh ref={halo} material={m.halo}>
      <circleGeometry args={[radius * 3.6, 96]} />
    </mesh>
    <mesh ref={innerRing} material={m.innerRing}>
      <ringGeometry args={[radius * 1.17, radius * 1.172, 256, 1]} />
    </mesh>
    <mesh ref={outerRing} material={m.outerRing}>
      <ringGeometry args={[radius * 1.34, radius * 1.343, 256, 1]} />
    </mesh>
    {/* Parallax depth: three shells at different z, sizes and drift rates. */}
    <DriftField count={shellsBase} seed={211} spread={[radius * 6.2, radius * 4.6, radius * 1.4]} centre={[0, 0, -radius * .6]} size={[.5, 1.5]} colour="platinum" accent="ice" alpha={.5} drift={.5} twinkle={.7} />
    <DriftField count={Math.floor(shellsBase * .7)} seed={317} spread={[radius * 4.4, radius * 3.2, radius * 3.4]} centre={[0, 0, radius * .4]} size={[.7, 2.2]} colour="infra" accent="cognitionDeep" alpha={.2} drift={.9} twinkle={.45} />
    <DriftField count={Math.floor(shellsBase * .32)} seed={419} spread={[radius * 9, radius * 6.5, radius * 2]} centre={[0, 0, -radius * 2.4]} size={[1, 2.6]} colour="silverDim" accent="platinum" alpha={.14} drift={.3} twinkle={.9} />
  </group>;
}
