'use client';
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Group, RingGeometry, ShaderMaterial } from 'three';
import type { ModelNode, RouteObservation } from '../cognition-router-policy.ts';
import { seededUnit } from '../forge-visual-policy.ts';
import type { RegionHealth } from '../telemetry-instrument-policy.ts';
import { modelChoreography, sceneChoreography, type ChoreographyState } from '../transition-choreography.ts';
import { COLOUR, MOTION, type SemanticColour } from '../visual-tokens.ts';
import { damp } from './damp.ts';
import { discMaterial, palette, ribbonGeometry, ribbonMaterial, ringMaterial } from './primitives.ts';
import { rate, useCosmosClock } from './runtime.tsx';

interface LinkTargets { draw: number; alpha: number; width: number; pulse: number; pulseSpeed: number; pulseCount: number; flicker: number; broken: number; hold: number; colour: SemanticColour; node: number; nodeColour: SemanticColour }

/** Connection and node energy from observed route state only. */
export function linkTargets(node: ModelNode): LinkTargets {
  const nodeColour: SemanticColour = node.health === 'offline' ? 'critical' : node.health === 'degraded' || node.circuit === 'open' ? 'degraded' : node.route === 'SELECTED' ? (node.viaFallback ? 'degraded' : 'cognition') : 'infra';
  const base: LinkTargets = { draw: 0, alpha: 0, width: 1, pulse: 0, pulseSpeed: 0, pulseCount: 3, flicker: 0, broken: 0, hold: 0, colour: 'cognition', node: .16, nodeColour };
  if (node.departing) return { ...base, node: 0, nodeColour: 'silverDim' };
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

/** Depth as information: selected forward, candidates mid-plane, history and failure recede. Scale only, so labels stay pinned. */
export function nodeDepth(node: ModelNode): number {
  if (node.departing) return .7;
  if (node.activity === 'stale') return .84;
  const locality = node.locality === 'cloud-ok' ? .95 : 1;
  const route = { SELECTED: 1.18, CANDIDATE: 1, FALLBACK: .93, REJECTED: .9, FAILED: .82, UNAVAILABLE: .78, HISTORICAL: .85 }[node.route];
  return route * locality;
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
function blend(a: LinkTargets, b: LinkTargets, t: number): LinkTargets {
  if (t <= 0) return a;
  if (t >= 1) return b;
  return { ...(t < .5 ? a : b), draw: mix(a.draw, b.draw, t), alpha: mix(a.alpha, b.alpha, t), width: mix(a.width, b.width, t), pulse: mix(a.pulse, b.pulse, t), pulseSpeed: mix(a.pulseSpeed, b.pulseSpeed, t), flicker: mix(a.flicker, b.flicker, t), broken: mix(a.broken, b.broken, t), hold: mix(a.hold, b.hold, t), node: mix(a.node, b.node, t) };
}

function ModelLink({ node, from, to, coreRadius, k, choreo }: { node: ModelNode; from: [number, number]; to: [number, number]; coreRadius: number; k: number; choreo: RefObject<ChoreographyState> }) {
  const clock = useCosmosClock();
  const group = useRef<Group>(null), pulseRing = useRef<Group>(null);
  const local = node.locality === 'local';
  const m = useMemo(() => ({
    link: ribbonMaterial(), halo: discMaterial('cognition', 2.4, .18),
    ring: ringMaterial(.8, 1, { ticks: local ? 16 : 40, tickAlpha: local ? .34 : .18 }),
    context: ringMaterial(.9, 1, { colour: 'cognition' }),
    rhythm: ringMaterial(.96, 1, { colour: 'ice', packets: 3 }),
    beat: ringMaterial(.9, 1, { colour: 'ice' }),
    ringGeometry: new RingGeometry(.8, 1, 64, 1), contextGeometry: new RingGeometry(.9, 1, 64, 1), rhythmGeometry: new RingGeometry(.96, 1, 64, 1),
  }), [local]);
  useEffect(() => () => { [m.link, m.halo, m.ring, m.context, m.rhythm, m.beat].forEach(x => x.dispose()); [m.ringGeometry, m.contextGeometry, m.rhythmGeometry].forEach(x => x.dispose()); }, [m]);
  const live = useRef({ x: to[0], y: to[1], draw: 0, alpha: 0, width: 1, pulse: 0, flicker: 0, broken: 0, hold: 0, node: 0, phase: 0, context: 0, depth: nodeDepth(node), rhythm: 0, beat: 0, beatT: 0, ret: 0 });
  useFrame(() => {
    const s = live.current, dt = clock.dt, settle = rate(clock, MOTION.dampSettle), fast = rate(clock, MOTION.dampFast);
    const c = modelChoreography(choreo.current, node.modelId, performance.now(), clock.snap);
    let targets = linkTargets(node);
    const choreographed = c.lock < 1 || c.retain > 0 || c.branch > 0 || c.wake > 0 || c.fracture < 1 || c.returnProgress !== undefined;
    if (c.lock < 1) targets = blend(linkTargets({ ...node, route: 'CANDIDATE' }), targets, c.lock);
    targets = { ...targets, pulse: targets.pulse * c.pulse };
    if (c.retain > 0) { const held = linkTargets({ ...node, route: 'SELECTED', activity: 'inferring' }); targets = blend(targets, { ...held, pulse: held.pulse * c.energy }, c.retain); }
    if (c.branch > 0 || c.wake > 0) targets = { ...targets, draw: Math.max(targets.draw, .6 * c.branch), alpha: Math.max(targets.alpha, .3 * c.branch), flicker: Math.max(targets.flicker, .6 * c.branch), node: targets.node + .22 * c.wake };
    if (c.fracture < 1) targets = { ...targets, broken: targets.broken * c.fracture, flicker: Math.max(targets.flicker, Math.sin(Math.PI * c.fracture) * .9) };
    // Envelopes already carry the timing; damping them again would smear the timeline.
    const follow = choreographed ? rate(clock, 14) : settle;
    s.x = damp(s.x, to[0], settle, dt); s.y = damp(s.y, to[1], settle, dt);
    s.draw = damp(s.draw, targets.draw, choreographed ? follow : targets.draw > s.draw ? rate(clock, 1.6) : fast, dt);
    s.alpha = damp(s.alpha, targets.alpha, follow, dt); s.width = damp(s.width, targets.width, follow, dt);
    s.pulse = damp(s.pulse, targets.pulse, follow, dt); s.flicker = damp(s.flicker, targets.flicker, follow, dt);
    s.broken = damp(s.broken, targets.broken, choreographed ? follow : fast, dt); s.hold = damp(s.hold, targets.hold, settle, dt); s.node = damp(s.node, targets.node, follow, dt);
    s.context = damp(s.context, node.contextRatio ?? 0, settle, dt);
    s.depth = damp(s.depth, nodeDepth(node) * (node.route === 'SELECTED' ? mix(.92, 1, c.lock) : 1), rate(clock, 1.8), dt);
    s.phase += dt * clock.scale * targets.pulseSpeed;
    const dx = s.x - from[0], dy = s.y - from[1], len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
    const start = [from[0] + ux * coreRadius * .72, from[1] + uy * coreRadius * .72] as const;
    const nodeR = 14 * k;
    const end = [s.x - ux * nodeR * 1.4, s.y - uy * nodeR * 1.4] as const;
    const bend = len * .1 * (uy >= 0 ? 1 : -1);
    const u = m.link.uniforms;
    u.uP0.value.set(start[0], start[1], 0); u.uP1.value.set((start[0] + end[0]) / 2 - uy * bend, (start[1] + end[1]) / 2 + ux * bend, 0); u.uP2.value.set(end[0], end[1], 0);
    u.uWidth.value = s.width * k * 1.6; u.uDraw.value = s.draw; u.uAlpha.value = s.alpha; u.uFlicker.value = s.flicker; u.uBroken.value = s.broken; u.uHold.value = s.hold; u.uTime.value = clock.t; u.uDash.value = node.locality === 'cloud-ok' ? .3 : 0;
    if (c.returnProgress !== undefined) {
      // Result energy travels node -> Core: a single pulse whose position runs backwards along the link.
      s.ret = 1;
      u.uPulse.value = Math.sin(Math.PI * c.returnProgress) * 1.2; u.uPulseCount.value = 1; u.uPhase.value = 1 - c.returnProgress - .1;
      u.uDraw.value = Math.max(s.draw, 1 - c.returnProgress * .2); u.uAlpha.value = Math.max(s.alpha, .3 * Math.sin(Math.PI * c.returnProgress));
    } else { u.uPulse.value = s.pulse; u.uPulseCount.value = targets.pulseCount; u.uPhase.value = s.phase; }
    u.uColour.value.lerp(palette(targets.colour), 1 - Math.exp(-4 * dt)); u.uPulseColour.value.copy(palette(targets.colour === 'degraded' ? 'forge' : 'ice'));
    if (group.current) { group.current.position.set(s.x, s.y, .1); group.current.scale.setScalar(nodeR * (.8 + s.node * .35) * s.depth); }
    const lerp = 1 - Math.exp(-4 * dt);
    const unknownHealth = node.health === undefined && !node.departing;
    m.halo.uniforms.uAlpha.value = s.node * (node.route === 'SELECTED' ? .62 : .42) * Math.min(1, s.depth); m.halo.uniforms.uColour.value.lerp(palette(targets.nodeColour), lerp);
    const ringColour: SemanticColour = unknownHealth ? 'silverDim' : targets.nodeColour === 'cognition' ? 'ice' : targets.nodeColour === 'infra' ? (local ? 'platinum' : 'infra') : targets.nodeColour;
    m.ring.uniforms.uAlpha.value = (unknownHealth ? .08 : .12) + s.node * .4; m.ring.uniforms.uColour.value.lerp(palette(ringColour), lerp);
    m.ring.uniforms.uGap.value = node.circuit === 'open' || node.route === 'FAILED' ? 1 : unknownHealth ? .5 : 0;
    m.ring.uniforms.uArc.value = node.route === 'FAILED' ? .72 : 1; m.ring.uniforms.uArcStart.value = clock.t * (local ? .03 : .05);
    m.ring.uniforms.uWave.value = node.health === 'degraded' ? 1 : 0; m.ring.uniforms.uWaveAmp.value = .05; m.ring.uniforms.uTime.value = clock.t;
    m.context.uniforms.uAlpha.value = node.contextRatio === undefined ? 0 : .55 * Math.min(1, s.node * 1.2); m.context.uniforms.uArc.value = Math.max(.001, s.context); m.context.uniforms.uArcStart.value = .25;
    m.context.uniforms.uColour.value.copy(palette(s.context > .85 ? 'degraded' : 'cognition'));
    // Throughput rhythm: packets orbit only when the run reports tokens per second.
    const tps = node.route === 'SELECTED' && node.activity === 'inferring' ? node.tokensPerSecond : undefined;
    s.rhythm = damp(s.rhythm, tps === undefined ? 0 : 1, settle, dt);
    m.rhythm.uniforms.uAlpha.value = s.rhythm * .3; m.rhythm.uniforms.uPhase.value += dt * clock.scale * Math.min(2.4, (tps ?? 0) / 60);
    // Latency pulse: a heartbeat whose period is the observed latency; absent when latency is unknown.
    const beating = node.route === 'SELECTED' && node.latencyMs !== undefined && (node.activity === 'inferring' || node.activity === 'awaiting-first-token');
    s.beat = damp(s.beat, beating ? 1 : 0, settle, dt);
    const period = Math.max(.7, Math.min(4, (node.latencyMs ?? 1000) / 1000));
    s.beatT = (s.beatT + dt * clock.scale / period) % 1;
    if (pulseRing.current) pulseRing.current.scale.setScalar(1.1 + s.beatT * .9);
    m.beat.uniforms.uAlpha.value = s.beat * (1 - s.beatT) * .35; m.beat.uniforms.uColour.value.copy(palette(node.viaFallback ? 'forge' : 'ice'));
  });
  return <>
    <mesh geometry={ribbonGeometry(64)} material={m.link} frustumCulled={false} renderOrder={10} />
    <group ref={group}>
      <mesh material={m.halo} renderOrder={11}><planeGeometry args={[3.2, 3.2]} /></mesh>
      <mesh material={m.ring} geometry={m.ringGeometry} renderOrder={12} />
      <mesh material={m.context} geometry={m.contextGeometry} scale={1.45} renderOrder={12} />
      <mesh material={m.rhythm} geometry={m.rhythmGeometry} scale={1.8} renderOrder={12} />
      <group ref={pulseRing}><mesh material={m.beat} geometry={m.contextGeometry} renderOrder={12} /></group>
    </group>
  </>;
}

const FIELD_VERTEX = /* glsl */ `attribute float aSeed; attribute float aRadius; attribute float aAngle; attribute float aSize;
uniform vec2 uCore; uniform float uRadius; uniform float uTime; uniform float uPixel; uniform float uSpan; uniform float uFrom;
varying float vSeed;
void main(){float ang=uFrom+fract(aAngle+uTime*(.004+aSeed*.006))*uSpan;float r=uRadius*aRadius;
  vec3 p=vec3(uCore.x+cos(ang)*r,uCore.y+sin(ang)*r,-.2-aSeed*.6);vSeed=aSeed;
  vec4 mv=modelViewMatrix*vec4(p,1.);gl_PointSize=aSize*uPixel*(9./max(-mv.z,.5));gl_Position=projectionMatrix*mv;}`;
const FIELD_FRAGMENT = /* glsl */ `uniform vec3 uColour; uniform float uAlpha; uniform float uTime; varying float vSeed;
void main(){vec2 c=gl_PointCoord*2.-1.;float r=dot(c,c);if(r>1.)discard;float tw=.65+.35*sin(uTime*(.6+vSeed*1.4)+vSeed*40.);gl_FragColor=vec4(uColour,pow(max(1.-r,0.),2.)*uAlpha*tw);}`;

/** One locality's physical field: cloud is finer, sparser and cooler; local is denser and warmer. */
function LocalityParticles({ core, radius, cloud, count, presence }: { core: [number, number]; radius: number; cloud: boolean; count: number; presence: number }) {
  const clock = useCosmosClock();
  const dpr = useThree(state => state.viewport.dpr);
  const m = useMemo(() => {
    const seed = new Float32Array(count), r = new Float32Array(count), angle = new Float32Array(count), size = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      seed[i] = seededUnit(cloud ? 211 : 223, i);
      r[i] = .72 + seededUnit(cloud ? 227 : 229, i) * .56;
      angle[i] = seededUnit(cloud ? 233 : 239, i);
      size[i] = cloud ? .6 + seededUnit(241, i) * .7 : 1 + seededUnit(251, i) * 1.2;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('aSeed', new BufferAttribute(seed, 1)); geometry.setAttribute('aRadius', new BufferAttribute(r, 1));
    geometry.setAttribute('aAngle', new BufferAttribute(angle, 1)); geometry.setAttribute('aSize', new BufferAttribute(size, 1));
    const material = new ShaderMaterial({ vertexShader: FIELD_VERTEX, fragmentShader: FIELD_FRAGMENT, transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending,
      uniforms: { uCore: { value: [0, 0] }, uRadius: { value: 1 }, uTime: { value: 0 }, uPixel: { value: 1 }, uSpan: { value: 1 }, uFrom: { value: 0 }, uColour: { value: new Color(cloud ? COLOUR.ice : COLOUR.platinum) }, uAlpha: { value: 0 } } });
    if (!cloud) (material.uniforms.uColour!.value as Color).lerp(new Color(COLOUR.forge), .18);
    return { geometry, material };
  }, [count, cloud]);
  useEffect(() => () => { m.geometry.dispose(); m.material.dispose(); }, [m]);
  const s = useRef({ alpha: 0 });
  useFrame(() => {
    const u = m.material.uniforms;
    s.current.alpha = damp(s.current.alpha, presence, rate(clock, MOTION.dampSlow), clock.dt);
    u.uCore!.value = core; u.uRadius!.value = radius; u.uTime!.value = clock.t; u.uPixel!.value = dpr;
    // Cloud arc spans 6°..70° above the boundary, local −6°..−70° below (world y is up).
    u.uFrom!.value = cloud ? 6 * Math.PI / 180 : -70 * Math.PI / 180; u.uSpan!.value = 64 * Math.PI / 180;
    u.uAlpha!.value = s.current.alpha * (cloud ? .16 : .22);
  });
  return <points geometry={m.geometry} material={m.material} frustumCulled={false} renderOrder={8} />;
}

export function CognitionField({ nodes, positions, core, coreRadius, modelRadius, boundary, route, gatewayHealth, k, current, choreo, fieldCount }: { nodes: ModelNode[]; positions: Array<[number, number]>; core: [number, number]; coreRadius: number; modelRadius: number; boundary: [[number, number], [number, number]]; route?: RouteObservation; gatewayHealth: RegionHealth; k: number; current: boolean; choreo: RefObject<ChoreographyState>; fieldCount: number }) {
  const clock = useCosmosClock();
  const m = useMemo(() => ({ boundary: ribbonMaterial(), crossing: ribbonMaterial(), wave: ringMaterial(.992, 1, { colour: 'degraded', accent: 'forge', ticks: 90, tickAlpha: .5 }), isolation: ringMaterial(.996, 1, { colour: 'degraded', ticks: 60, tickAlpha: .35 }), ring: new RingGeometry(.992, 1, 192, 1), isolationRing: new RingGeometry(.996, 1, 192, 1) }), []);
  useEffect(() => () => { m.boundary.dispose(); m.crossing.dispose(); m.wave.dispose(); m.isolation.dispose(); m.ring.dispose(); m.isolationRing.dispose(); }, [m]);
  const waveGroup = useRef<Group>(null);
  const live = useRef({ wave: 0, cycle: 0, isolation: 0, boundary: 0, flash: 0 });
  const fallbackActive = Boolean(current && route?.current && route.fallback);
  const isolated = current && (gatewayHealth === 'degraded' || gatewayHealth === 'offline');
  const byId = new Map(nodes.flatMap((node, i) => positions[i] ? [[node.modelId, positions[i]!] as const] : []));
  const hasCloud = nodes.some(node => node.locality === 'cloud-ok' && !node.departing), hasLocal = nodes.some(node => node.locality === 'local' && !node.departing);
  useFrame(() => {
    const s = live.current, dt = clock.dt, settle = rate(clock, MOTION.dampSettle);
    s.wave = damp(s.wave, fallbackActive ? 1 : 0, settle, dt); s.isolation = damp(s.isolation, isolated ? 1 : 0, settle, dt); s.boundary = damp(s.boundary, nodes.length ? 1 : 0, settle, dt);
    s.cycle = (s.cycle + dt * clock.scale * .42) % 1;
    if (waveGroup.current) { waveGroup.current.position.set(core[0], core[1], 0); waveGroup.current.scale.setScalar(coreRadius * .8 + (modelRadius * 1.15 - coreRadius * .8) * s.cycle); }
    m.wave.uniforms.uAlpha.value = s.wave * (1 - s.cycle) * .5; m.wave.uniforms.uArc.value = .3; m.wave.uniforms.uArcStart.value = 1 - .15;
    m.isolation.uniforms.uAlpha.value = s.isolation * .2; m.isolation.uniforms.uArc.value = .36; m.isolation.uniforms.uArcStart.value = 1 - .18; m.isolation.uniforms.uGap.value = 1;
    m.isolation.uniforms.uColour.value.copy(palette(gatewayHealth === 'offline' ? 'critical' : 'degraded'));
    const scene = sceneChoreography(choreo.current, performance.now(), clock.snap);
    const crossing = scene.crossing && byId.get(scene.crossing.from) && byId.get(scene.crossing.to) ? scene.crossing : undefined;
    s.flash = damp(s.flash, crossing ? Math.max(0, 1 - Math.abs(crossing.progress - .5) * 4) : 0, rate(clock, 10), dt);
    const u = m.boundary.uniforms;
    u.uP0.value.set(boundary[0][0], boundary[0][1], 0); u.uP2.value.set(boundary[1][0], boundary[1][1], 0); u.uP1.value.set((boundary[0][0] + boundary[1][0]) / 2, (boundary[0][1] + boundary[1][1]) / 2, 0);
    u.uWidth.value = k * (1.2 + s.flash * 2); u.uDraw.value = 1; u.uAlpha.value = s.boundary * (.14 + s.flash * .5); u.uDash.value = 1 - s.flash; u.uColour.value.copy(palette(s.flash > .05 ? 'ice' : 'silverDim'));
    const c = m.crossing.uniforms;
    if (crossing) {
      // A Bézier through the boundary seam: P1 chosen so the curve passes the seam at t = .5.
      const a = byId.get(crossing.from)!, b = byId.get(crossing.to)!, seam: [number, number] = [core[0] + modelRadius * .95, core[1]];
      c.uP0.value.set(a[0], a[1], 0); c.uP2.value.set(b[0], b[1], 0); c.uP1.value.set(2 * seam[0] - (a[0] + b[0]) / 2, 2 * seam[1] - (a[1] + b[1]) / 2, 0);
      c.uWidth.value = k * 2.2; c.uDraw.value = 1; c.uAlpha.value = Math.sin(Math.PI * crossing.progress) * .35; c.uPulse.value = 1.4; c.uPulseCount.value = 1; c.uPhase.value = crossing.progress - .1;
      c.uColour.value.copy(palette('cognitionDeep')); c.uPulseColour.value.copy(palette('ice'));
    } else c.uAlpha.value = 0;
  });
  return <group>
    <LocalityParticles core={core} radius={modelRadius} cloud count={Math.round(fieldCount * .35)} presence={hasCloud ? 1 : .25} />
    <LocalityParticles core={core} radius={modelRadius} cloud={false} count={Math.round(fieldCount * .65)} presence={hasLocal ? 1 : .25} />
    <mesh geometry={ribbonGeometry(16)} material={m.boundary} frustumCulled={false} renderOrder={9} />
    <mesh geometry={ribbonGeometry(48)} material={m.crossing} frustumCulled={false} renderOrder={13} />
    <group ref={waveGroup}><mesh material={m.wave} geometry={m.ring} renderOrder={9} /></group>
    <mesh material={m.isolation} geometry={m.isolationRing} position={[core[0], core[1], 0]} scale={modelRadius * 1.2} renderOrder={9} />
    {nodes.map((node, i) => positions[i] ? <ModelLink key={node.modelId} node={node} from={core} to={positions[i]!} coreRadius={coreRadius} k={k} choreo={choreo} /> : null)}
  </group>;
}
