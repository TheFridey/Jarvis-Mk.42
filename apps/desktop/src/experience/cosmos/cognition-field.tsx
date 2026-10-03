'use client';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group, RingGeometry } from 'three';
import type { ModelNode, RouteObservation } from '../cognition-router-policy.ts';
import type { RegionHealth } from '../telemetry-instrument-policy.ts';
import { MOTION, type SemanticColour } from '../visual-tokens.ts';
import { damp } from './damp.ts';
import { discMaterial, palette, ribbonGeometry, ribbonMaterial, ringMaterial } from './primitives.ts';
import { rate, useCosmosClock } from './runtime.tsx';

interface LinkTargets { draw: number; alpha: number; width: number; pulse: number; pulseSpeed: number; pulseCount: number; flicker: number; broken: number; hold: number; colour: SemanticColour; node: number; nodeColour: SemanticColour }

/** Connection and node energy from observed route state only. */
export function linkTargets(node: ModelNode): LinkTargets {
  const nodeColour: SemanticColour = node.health === 'offline' ? 'critical' : node.health === 'degraded' || node.circuit === 'open' ? 'degraded' : node.route === 'SELECTED' ? (node.viaFallback ? 'degraded' : 'cognition') : 'infra';
  const base: LinkTargets = { draw: 0, alpha: 0, width: 1, pulse: 0, pulseSpeed: 0, pulseCount: 3, flicker: 0, broken: 0, hold: 0, colour: 'cognition', node: .16, nodeColour };
  if (node.activity === 'stale') return { ...base, node: .1, nodeColour: 'silverDim' };
  switch (node.route) {
    case 'SELECTED': {
      const inferring = node.activity === 'inferring', waiting = node.activity === 'awaiting-first-token', unconfirmed = node.activity === 'unconfirmed';
      return { ...base, draw: 1, alpha: unconfirmed ? .22 : .7, width: 2.4, pulse: inferring ? 1 : waiting ? .5 : 0, pulseSpeed: inferring ? .85 : .25, pulseCount: inferring ? 5 : 2, hold: waiting ? .6 : 0, colour: node.viaFallback ? 'degraded' : 'cognition', node: unconfirmed ? .45 : 1 };
    }
    case 'CANDIDATE': return { ...base, draw: .55, alpha: .28, width: 1.2, flicker: .7, node: .5 };
    case 'REJECTED': return { ...base, draw: .1, alpha: .1, node: .26 };
    case 'FAILED': return { ...base, draw: 1, alpha: .32, width: 1.4, broken: 1, colour: 'degraded', node: .38 };
    case 'UNAVAILABLE': return { ...base, draw: .32, alpha: .12, broken: 1, colour: 'silverDim', node: .18 };
    case 'FALLBACK': return { ...base, draw: .28, alpha: .14, colour: 'degraded', node: .3 };
    default: return base;
  }
}

function ModelLink({ node, from, to, coreRadius, k }: { node: ModelNode; from: [number, number]; to: [number, number]; coreRadius: number; k: number }) {
  const clock = useCosmosClock();
  const targets = linkTargets(node);
  const group = useRef<Group>(null);
  const m = useMemo(() => ({ link: ribbonMaterial(), halo: discMaterial('cognition', 2.4, .18), ring: ringMaterial(.8, 1, { ticks: 24, tickAlpha: .25 }), context: ringMaterial(.9, 1, { colour: 'cognition' }), ringGeometry: new RingGeometry(.8, 1, 64, 1), contextGeometry: new RingGeometry(.9, 1, 64, 1) }), []);
  useEffect(() => () => { m.link.dispose(); m.halo.dispose(); m.ring.dispose(); m.context.dispose(); m.ringGeometry.dispose(); m.contextGeometry.dispose(); }, [m]);
  const live = useRef({ x: to[0], y: to[1], draw: 0, alpha: 0, width: 1, pulse: 0, flicker: 0, broken: 0, hold: 0, node: 0, phase: 0, context: 0 });
  useFrame(() => {
    const s = live.current, dt = clock.dt, settle = rate(clock, MOTION.dampSettle), fast = rate(clock, MOTION.dampFast);
    s.x = damp(s.x, to[0], settle, dt); s.y = damp(s.y, to[1], settle, dt);
    s.draw = damp(s.draw, targets.draw, targets.draw > s.draw ? rate(clock, 1.6) : fast, dt);
    s.alpha = damp(s.alpha, targets.alpha, settle, dt); s.width = damp(s.width, targets.width, settle, dt);
    s.pulse = damp(s.pulse, targets.pulse, settle, dt); s.flicker = damp(s.flicker, targets.flicker, settle, dt);
    s.broken = damp(s.broken, targets.broken, fast, dt); s.hold = damp(s.hold, targets.hold, settle, dt); s.node = damp(s.node, targets.node, settle, dt);
    s.context = damp(s.context, node.contextRatio ?? 0, settle, dt);
    s.phase += dt * clock.scale * targets.pulseSpeed;
    const dx = s.x - from[0], dy = s.y - from[1], len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
    const start = [from[0] + ux * coreRadius * .72, from[1] + uy * coreRadius * .72] as const;
    const nodeR = 14 * k;
    const end = [s.x - ux * nodeR * 1.4, s.y - uy * nodeR * 1.4] as const;
    const bend = len * .1 * (uy >= 0 ? 1 : -1);
    const u = m.link.uniforms;
    u.uP0.value.set(start[0], start[1], 0); u.uP1.value.set((start[0] + end[0]) / 2 - uy * bend, (start[1] + end[1]) / 2 + ux * bend, 0); u.uP2.value.set(end[0], end[1], 0);
    u.uWidth.value = s.width * k * 1.6; u.uDraw.value = s.draw; u.uAlpha.value = s.alpha; u.uPulse.value = s.pulse; u.uPhase.value = s.phase; u.uPulseCount.value = targets.pulseCount;
    u.uFlicker.value = s.flicker; u.uBroken.value = s.broken; u.uHold.value = s.hold; u.uTime.value = clock.t; u.uDash.value = node.locality === 'cloud-ok' ? .3 : 0;
    u.uColour.value.lerp(palette(targets.colour), 1 - Math.exp(-4 * dt)); u.uPulseColour.value.copy(palette(targets.colour === 'degraded' ? 'forge' : 'ice'));
    if (group.current) { group.current.position.set(s.x, s.y, .1); group.current.scale.setScalar(nodeR * (.8 + s.node * .35)); }
    m.halo.uniforms.uAlpha.value = s.node * .5; m.halo.uniforms.uColour.value.lerp(palette(targets.nodeColour), 1 - Math.exp(-4 * dt));
    m.ring.uniforms.uAlpha.value = .12 + s.node * .4; m.ring.uniforms.uColour.value.lerp(palette(targets.nodeColour === 'cognition' ? 'ice' : targets.nodeColour), 1 - Math.exp(-4 * dt));
    m.ring.uniforms.uGap.value = node.circuit === 'open' ? 1 : 0; m.ring.uniforms.uArcStart.value = clock.t * .05;
    m.context.uniforms.uAlpha.value = node.contextRatio === undefined ? 0 : .55; m.context.uniforms.uArc.value = Math.max(.001, s.context); m.context.uniforms.uArcStart.value = .25;
    m.context.uniforms.uColour.value.copy(palette(s.context > .85 ? 'degraded' : 'cognition'));
  });
  return <>
    <mesh geometry={ribbonGeometry(64)} material={m.link} frustumCulled={false} renderOrder={10} />
    <group ref={group}>
      <mesh material={m.halo} renderOrder={11}><planeGeometry args={[3.2, 3.2]} /></mesh>
      <mesh material={m.ring} geometry={m.ringGeometry} renderOrder={12} />
      <mesh material={m.context} geometry={m.contextGeometry} scale={1.45} renderOrder={12} />
    </group>
  </>;
}

export function CognitionField({ nodes, positions, core, coreRadius, modelRadius, boundary, route, gatewayHealth, k, current }: { nodes: ModelNode[]; positions: Array<[number, number]>; core: [number, number]; coreRadius: number; modelRadius: number; boundary: [[number, number], [number, number]]; route?: RouteObservation; gatewayHealth: RegionHealth; k: number; current: boolean }) {
  const clock = useCosmosClock();
  const m = useMemo(() => ({ boundary: ribbonMaterial(), wave: ringMaterial(.992, 1, { colour: 'degraded', accent: 'forge', ticks: 90, tickAlpha: .5 }), isolation: ringMaterial(.996, 1, { colour: 'degraded', ticks: 60, tickAlpha: .35 }), ring: new RingGeometry(.992, 1, 192, 1), isolationRing: new RingGeometry(.996, 1, 192, 1) }), []);
  useEffect(() => () => { m.boundary.dispose(); m.wave.dispose(); m.isolation.dispose(); m.ring.dispose(); m.isolationRing.dispose(); }, [m]);
  const waveGroup = useRef<Group>(null);
  const live = useRef({ wave: 0, cycle: 0, isolation: 0, boundary: 0 });
  const fallbackActive = Boolean(current && route?.current && route.fallback);
  const isolated = current && (gatewayHealth === 'degraded' || gatewayHealth === 'offline');
  useFrame(() => {
    const s = live.current, dt = clock.dt, settle = rate(clock, MOTION.dampSettle);
    s.wave = damp(s.wave, fallbackActive ? 1 : 0, settle, dt); s.isolation = damp(s.isolation, isolated ? 1 : 0, settle, dt); s.boundary = damp(s.boundary, nodes.length ? 1 : 0, settle, dt);
    s.cycle = (s.cycle + dt * clock.scale * .42) % 1;
    if (waveGroup.current) { waveGroup.current.position.set(core[0], core[1], 0); waveGroup.current.scale.setScalar(coreRadius * .8 + (modelRadius * 1.15 - coreRadius * .8) * s.cycle); }
    m.wave.uniforms.uAlpha.value = s.wave * (1 - s.cycle) * .5; m.wave.uniforms.uArc.value = .3; m.wave.uniforms.uArcStart.value = 1 - .15;
    m.isolation.uniforms.uAlpha.value = s.isolation * .2; m.isolation.uniforms.uArc.value = .36; m.isolation.uniforms.uArcStart.value = 1 - .18; m.isolation.uniforms.uGap.value = 1;
    m.isolation.uniforms.uColour.value.copy(palette(gatewayHealth === 'offline' ? 'critical' : 'degraded'));
    const u = m.boundary.uniforms;
    u.uP0.value.set(boundary[0][0], boundary[0][1], 0); u.uP2.value.set(boundary[1][0], boundary[1][1], 0); u.uP1.value.set((boundary[0][0] + boundary[1][0]) / 2, (boundary[0][1] + boundary[1][1]) / 2, 0);
    u.uWidth.value = k * 1.2; u.uDraw.value = 1; u.uAlpha.value = s.boundary * .3; u.uDash.value = 1; u.uColour.value.copy(palette('silverDim'));
  });
  return <group>
    <mesh geometry={ribbonGeometry(16)} material={m.boundary} frustumCulled={false} renderOrder={9} />
    <group ref={waveGroup}><mesh material={m.wave} geometry={m.ring} renderOrder={9} /></group>
    <mesh material={m.isolation} geometry={m.isolationRing} position={[core[0], core[1], 0]} scale={modelRadius * 1.2} renderOrder={9} />
    {nodes.map((node, i) => positions[i] ? <ModelLink key={node.modelId} node={node} from={core} to={positions[i]!} coreRadius={coreRadius} k={k} /> : null)}
  </group>;
}
