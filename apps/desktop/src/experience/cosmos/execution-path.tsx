'use client';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Group, RingGeometry, ShaderMaterial, Vector3 } from 'three';
import type { ExperiencePhase } from '../experience-phase-policy.ts';
import { seededUnit } from '../forge-visual-policy.ts';
import { COLOUR, MOTION, type SemanticColour } from '../visual-tokens.ts';
import { damp } from './damp.ts';
import { discMaterial, palette, ribbonGeometry, ribbonMaterial, ringMaterial } from './primitives.ts';
import { rate, useCosmosClock } from './runtime.tsx';

const FLOW_VERTEX = /* glsl */ `attribute float aSeed; attribute float aLane;
uniform vec3 uP0; uniform vec3 uP1; uniform vec3 uP2; uniform float uTime; uniform float uDir; uniform float uLimit; uniform float uPixel; uniform float uSpread;
varying float vFade;
void main(){float f=fract(aSeed*9.13+uTime*(.18+aSeed*.22));float t=uDir>0.?f:1.-f;t*=uLimit;
  vec3 a=mix(uP0,uP1,t),b=mix(uP1,uP2,t),p=mix(a,b,t);vec3 d=normalize(b-a+1e-5);p+=vec3(-d.y,d.x,0.)*aLane*uSpread*(1.-abs(t*2.-1.)*.5);
  vFade=smoothstep(0.,.12,f)*smoothstep(1.,.8,f);vec4 mv=modelViewMatrix*vec4(p,1.);gl_PointSize=(1.4+aSeed*2.)*uPixel*(9./max(-mv.z,.5));gl_Position=projectionMatrix*mv;}`;
const FLOW_FRAGMENT = /* glsl */ `uniform vec3 uColour; uniform float uAlpha; varying float vFade;
void main(){vec2 c=gl_PointCoord*2.-1.;float r=dot(c,c);if(r>1.)discard;gl_FragColor=vec4(uColour,pow(max(1.-r,0.),2.)*uAlpha*vFade);}`;

interface PathTargets { visible: number; draw: number; hold: number; pulse: number; pulseDir: number; flow: number; flowDir: number; barrier: number; colour: SemanticColour; anchor: number }
export function executionTargets(phase: ExperiencePhase, barrierFraction: number): PathTargets {
  const none: PathTargets = { visible: 0, draw: 0, hold: 0, pulse: 0, pulseDir: 1, flow: 0, flowDir: 1, barrier: 0, colour: 'execution', anchor: 0 };
  switch (phase) {
    case 'APPROVAL': return { ...none, visible: 1, draw: barrierFraction, hold: 1, barrier: 1, anchor: .35 };
    case 'EXECUTING': return { ...none, visible: 1, draw: 1, pulse: 1, flow: 1, anchor: 1 };
    case 'VERIFYING': return { ...none, visible: 1, draw: 1, pulse: .8, pulseDir: -1, flow: .8, flowDir: -1, colour: 'verified', anchor: .8 };
    case 'COMPLETE': return { ...none, visible: .45, draw: 1, colour: 'verified', anchor: .5 };
    default: return none;
  }
}

export function ExecutionPath({ phase, core, coreRadius, barrier, anchor, k, fluxCount, criticalRisk }: { phase: ExperiencePhase; core: [number, number]; coreRadius: number; barrier: [number, number]; anchor: [number, number]; k: number; fluxCount: number; criticalRisk: boolean }) {
  const clock = useCosmosClock();
  const dpr = useThree(state => state.viewport.dpr);
  const dx = anchor[0] - core[0], dy = anchor[1] - core[1], len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
  const p0: [number, number] = [core[0] + ux * coreRadius * .96, core[1] + uy * coreRadius * .96];
  const bend = len * .08;
  const p1: [number, number] = [(p0[0] + anchor[0]) / 2 + uy * bend, (p0[1] + anchor[1]) / 2 - ux * bend];
  const barrierFraction = Math.min(.95, Math.hypot(barrier[0] - p0[0], barrier[1] - p0[1]) / Math.hypot(anchor[0] - p0[0], anchor[1] - p0[1]));
  const targets = executionTargets(phase, barrierFraction);
  const barrierGroup = useRef<Group>(null), anchorGroup = useRef<Group>(null);
  const m = useMemo(() => {
    const n = Math.max(60, Math.floor(fluxCount / 2));
    const seed = new Float32Array(n), lane = new Float32Array(n);
    for (let i = 0; i < n; i++) { seed[i] = seededUnit(131, i); lane[i] = (seededUnit(137, i) - .5) * 2; }
    const flow = new BufferGeometry();
    flow.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3)); flow.setAttribute('aSeed', new BufferAttribute(seed, 1)); flow.setAttribute('aLane', new BufferAttribute(lane, 1));
    return {
      path: ribbonMaterial(), glow: ribbonMaterial(), flow,
      flowMaterial: new ShaderMaterial({ vertexShader: FLOW_VERTEX, fragmentShader: FLOW_FRAGMENT, transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending, uniforms: { uP0: { value: new Vector3() }, uP1: { value: new Vector3() }, uP2: { value: new Vector3() }, uTime: { value: 0 }, uDir: { value: 1 }, uLimit: { value: 1 }, uPixel: { value: 1 }, uSpread: { value: .05 }, uColour: { value: new Color(COLOUR.execution) }, uAlpha: { value: 0 } } }),
      barrier: ringMaterial(.7, 1.02, { colour: 'execution', accent: 'forge', ticks: 6, tickAlpha: .9 }), barrierInner: ringMaterial(.62, .68, { colour: 'forge', ticks: 24, tickAlpha: .6 }),
      barrierGlow: discMaterial('execution', 2.2), anchorRing: ringMaterial(.8, 1, { colour: 'execution', ticks: 12, tickAlpha: .7, packets: 3 }), anchorGlow: discMaterial('execution', 2.4, .2),
      g1: new RingGeometry(.84, 1, 6, 1), g2: new RingGeometry(.62, .68, 96, 1), g3: new RingGeometry(.8, 1, 64, 1),
    };
  }, [fluxCount]);
  useEffect(() => () => { [m.path, m.glow, m.flowMaterial, m.barrier, m.barrierInner, m.barrierGlow, m.anchorRing, m.anchorGlow].forEach(x => x.dispose()); [m.flow, m.g1, m.g2, m.g3].forEach(x => x.dispose()); }, [m]);
  const s = useRef({ visible: 0, draw: 0, hold: 0, pulse: 0, flow: 0, barrier: 0, anchor: 0, phase: 0, spin: 0, unlock: 0, flowT: 0 });
  useFrame(() => {
    const v = s.current, dt = clock.dt, settle = rate(clock, MOTION.dampSettle);
    v.visible = damp(v.visible, targets.visible, settle, dt);
    v.draw = damp(v.draw, targets.draw, targets.draw > v.draw ? rate(clock, 1.2) : settle, dt);
    v.hold = damp(v.hold, targets.hold, settle, dt); v.pulse = damp(v.pulse, targets.pulse, settle, dt); v.flow = damp(v.flow, targets.flow, settle, dt);
    v.barrier = damp(v.barrier, targets.barrier, rate(clock, targets.barrier ? 2 : 1.2), dt); v.anchor = damp(v.anchor, targets.anchor, settle, dt);
    v.unlock = damp(v.unlock, phase === 'EXECUTING' || phase === 'VERIFYING' ? 1 : 0, rate(clock, 1.2), dt);
    v.phase += dt * clock.scale * .9 * targets.pulseDir; v.spin += dt * clock.scale * (phase === 'APPROVAL' ? .25 : .05); v.flowT += dt * clock.scale;
    const lerp = 1 - Math.exp(-3 * dt), colour = palette(targets.colour);
    for (const [material, width, alpha] of [[m.path, 2.2, .55], [m.glow, 9, .08]] as const) {
      const u = material.uniforms;
      u.uP0.value.set(p0[0], p0[1], 0); u.uP1.value.set(p1[0], p1[1], 0); u.uP2.value.set(anchor[0], anchor[1], 0);
      u.uWidth.value = k * width; u.uDraw.value = v.draw; u.uAlpha.value = v.visible * alpha; u.uHold.value = v.hold; u.uPulse.value = material === m.path ? v.pulse : 0; u.uPhase.value = v.phase; u.uPulseCount.value = 4;
      u.uColour.value.lerp(colour, lerp); u.uPulseColour.value.copy(palette(targets.colour === 'verified' ? 'platinum' : 'forge'));
    }
    const f = m.flowMaterial.uniforms;
    f.uP0!.value.set(p0[0], p0[1], 0); f.uP1!.value.set(p1[0], p1[1], 0); f.uP2!.value.set(anchor[0], anchor[1], 0);
    f.uTime!.value = v.flowT; f.uDir!.value = targets.flowDir; f.uPixel!.value = dpr; f.uSpread!.value = k * 14; f.uAlpha!.value = v.flow * .8; (f.uColour!.value as Color).lerp(colour, lerp);
    const barrierColour = palette(criticalRisk ? 'degraded' : 'execution');
    if (barrierGroup.current) { barrierGroup.current.position.set(barrier[0], barrier[1], .1); barrierGroup.current.scale.setScalar(k * 26 * (1 + v.unlock * .8)); barrierGroup.current.rotation.z = v.spin; }
    m.barrier.uniforms.uAlpha.value = v.barrier * .55 * (1 - v.unlock); m.barrier.uniforms.uColour.value.copy(barrierColour);
    m.barrierInner.uniforms.uAlpha.value = v.barrier * .35 * (1 - v.unlock); m.barrierInner.uniforms.uArcStart.value = -v.spin * .5;
    m.barrierGlow.uniforms.uAlpha.value = v.barrier * (.28 + .08 * Math.sin(clock.t * 1.4)) * (1 - v.unlock); m.barrierGlow.uniforms.uColour.value.copy(barrierColour);
    if (anchorGroup.current) { anchorGroup.current.position.set(anchor[0], anchor[1], .1); anchorGroup.current.scale.setScalar(k * 16); }
    m.anchorRing.uniforms.uAlpha.value = v.visible * (.15 + v.anchor * .4); m.anchorRing.uniforms.uTickAlpha.value = v.visible * (.12 + v.anchor * .58); m.anchorRing.uniforms.uPhase.value = v.flowT * .3 * v.anchor; m.anchorRing.uniforms.uColour.value.lerp(colour, lerp);
    m.anchorGlow.uniforms.uAlpha.value = v.visible * v.anchor * .5; m.anchorGlow.uniforms.uColour.value.lerp(colour, lerp);
  });
  return <group>
    <mesh geometry={ribbonGeometry(64)} material={m.glow} frustumCulled={false} renderOrder={9} />
    <mesh geometry={ribbonGeometry(64)} material={m.path} frustumCulled={false} renderOrder={10} />
    <points geometry={m.flow} material={m.flowMaterial} frustumCulled={false} renderOrder={11} />
    <group ref={barrierGroup}>
      <mesh material={m.barrierGlow} renderOrder={11}><planeGeometry args={[3, 3]} /></mesh>
      <mesh material={m.barrier} geometry={m.g1} renderOrder={12} />
      <mesh material={m.barrierInner} geometry={m.g2} renderOrder={12} />
    </group>
    <group ref={anchorGroup}>
      <mesh material={m.anchorGlow} renderOrder={11}><planeGeometry args={[3, 3]} /></mesh>
      <mesh material={m.anchorRing} geometry={m.g3} renderOrder={12} />
    </group>
  </group>;
}
