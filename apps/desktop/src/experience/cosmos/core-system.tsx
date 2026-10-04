'use client';
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { sceneChoreography, type ChoreographyState } from '../transition-choreography.ts';
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, EdgesGeometry, Group, IcosahedronGeometry, LineBasicMaterial, RingGeometry, ShaderMaterial, TetrahedronGeometry, Vector3 } from 'three';
import type { CoreSystemTargets } from '../core-visual-policy.ts';
import { seededUnit } from '../forge-visual-policy.ts';
import { COLOUR, MOTION, type SemanticColour } from '../visual-tokens.ts';
import { damp, dampAngle } from './damp.ts';
import { DISC_VERTEX, NOISE } from './glsl.ts';
import { discMaterial, palette, ringMaterial } from './primitives.ts';
import { rate, useCosmosClock } from './runtime.tsx';

const accentOf = (name: SemanticColour): SemanticColour => name === 'execution' || name === 'degraded' ? 'forge' : name === 'verified' ? 'platinum' : name === 'critical' ? 'critical' : 'ice';

const SHELL_VERTEX = /* glsl */ `varying vec3 vN; varying vec3 vP; varying vec3 vV;
void main(){vN=normalize(normalMatrix*normal);vP=position;vec4 mv=modelViewMatrix*vec4(position,1.);vV=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}`;
const SHELL_FRAGMENT = /* glsl */ `${NOISE}
uniform vec3 uColour; uniform vec3 uAmber; uniform float uLum; uniform float uNeural; uniform float uAsym; uniform float uTime; uniform float uFracture;
varying vec3 vN; varying vec3 vP; varying vec3 vV;
void main(){
  float fres=pow(clamp(1.-dot(normalize(vN),normalize(vV)),0.,1.),2.4);
  float bands=fbm(vP*3.5+vec3(0.,0.,uTime*.25),3);
  float flash=smoothstep(.72,.92,vnoise(vP*10.+vec3(uTime*1.6,0.,uTime)))*uNeural;
  float interference=step(.78,vnoise(vP*vec3(4.,26.,4.)+vec3(0.,uTime*5.,0.)))*uAsym;
  float crack=smoothstep(.02,0.,abs(vnoise(vP*6.)-.5))*uFracture;
  vec3 col=uColour*(.6+bands*.6)+uAmber*interference+vec3(1.,.35,.28)*crack;
  float a=fres*(.12+.42*uLum)+flash*.55+interference*.25+crack*.8+bands*.03*uLum;
  gl_FragColor=vec4(col,a);
}`;
const SCAN_FRAGMENT = /* glsl */ `#define TAU 6.28318530718
uniform float uAngle; uniform float uAlpha; uniform vec3 uColour; varying vec2 vUv;
void main(){float r=length(vUv);if(r>1.||r<.05||uAlpha<.002)discard;float ang=atan(vUv.y,vUv.x);float d=mod(uAngle-ang+TAU*4.,TAU);
  float trail=exp(-d*2.4);float fade=smoothstep(1.,.86,r)*smoothstep(.05,.3,r);float rings=.45+.55*step(.9,fract(r*7.));
  gl_FragColor=vec4(uColour,trail*fade*uAlpha*rings);}`;
const NEURAL_VERTEX = /* glsl */ `attribute float aSeed; varying float vSeed; void main(){vSeed=aSeed;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const NEURAL_FRAGMENT = /* glsl */ `uniform vec3 uColour; uniform float uTime; uniform float uNeural; uniform float uBase; varying float vSeed;
void main(){float fire=pow(max(0.,sin(uTime*(1.5+vSeed*5.)+vSeed*80.)),24.)*uNeural;gl_FragColor=vec4(uColour,uBase+fire*.9);}`;
const FLUX_VERTEX = /* glsl */ `attribute float aSeed; attribute vec3 aDir;
uniform float uTime; uniform float uPixel; uniform float uOuter; uniform float uInner; uniform float uSpeed; uniform float uScale;
varying float vFade;
void main(){float f=fract(uTime*uSpeed*(.5+aSeed*.5)+aSeed*13.7);vec3 p=aDir*mix(uOuter,uInner,f*f);vFade=smoothstep(0.,.2,f)*smoothstep(1.,.75,f);
  vec4 mv=modelViewMatrix*vec4(p,1.);gl_PointSize=(1.2+aSeed*1.8)*uPixel*(9./max(-mv.z,.5))*uScale;gl_Position=projectionMatrix*mv;}`;
const FLUX_FRAGMENT = /* glsl */ `uniform vec3 uColour; uniform float uAlpha; varying float vFade;
void main(){vec2 c=gl_PointCoord*2.-1.;float r=dot(c,c);if(r>1.)discard;gl_FragColor=vec4(uColour,pow(max(1.-r,0.),2.)*uAlpha*vFade);}`;

const RING_RADII = [.56, .645, .73, .815, .9];
const RING_TILT: Array<[number, number]> = [[1.18, .1], [1.32, -.42], [1.05, .55], [1.42, .25], [1.24, -.7]];
const RING_PACKETS = [3, 5, 2, 4, 6];

interface CoreState { lum: number; rings: number; orbit: number; indep: number; neural: number; shell: number; routing: number; forge: number; wave: number; inflow: number; outflow: number; returnFlow: number; scan: number; conv: number; asym: number; fracture: number; barrier: number }

/** Decorative ambience, not telemetry: a faint neural flash roughly every seventeen seconds while dormant. */
const ambientPulse = (ms: number) => Math.pow(Math.max(0, Math.sin(ms / 17_000 * Math.PI * 2)), 80);

export function CoreSystem({ position, scale, targets, routeAngle, envelopeAmplitude, segments, fluxCount, neuralCount, choreo }: { position: [number, number]; scale: number; targets: CoreSystemTargets; routeAngle?: number; envelopeAmplitude: number; segments: number; fluxCount: number; neuralCount: number; choreo?: RefObject<ChoreographyState> }) {
  const clock = useCosmosClock();
  const dpr = useThree(state => state.viewport.dpr);
  const group = useRef<Group>(null);
  const nucleus = useRef<Group>(null);
  const neuralGroup = useRef<Group>(null);
  const shards = useRef<Group>(null);
  const rings = useRef<Array<Group | null>>([]);
  const state = useRef<CoreState>({ lum: .2, rings: 2, orbit: .1, indep: 0, neural: 0, shell: 0, routing: 0, forge: 0, wave: 0, inflow: 0, outflow: 0, returnFlow: 0, scan: 0, conv: 0, asym: 0, fracture: 0, barrier: 0 });
  const phases = useRef({ rings: RING_RADII.map(() => 0), field: 0, nucleus: 0, scan: 0, lobe: 0, conv: 0 });
  const colourNow = useRef(new Color(COLOUR.infra));
  const accentNow = useRef(palette('ice'));

  const m = useMemo(() => {
    const geometry = {
      field: new RingGeometry(.985, 1, segments * 2, 1), outer: new RingGeometry(1.115, 1.12, segments * 2, 1),
      orbit: new RingGeometry(.994, 1, segments * 2, 1), routing: new RingGeometry(.69, .705, segments * 2, 1),
      wave: new RingGeometry(.5, .507, 256, 1), conv: new RingGeometry(.97, 1, segments, 1),
      nucleus: new EdgesGeometry(new IcosahedronGeometry(.19, 1)),
    };
    const neuralCountClamped = Math.min(220, neuralCount * 2);
    const nodes: Vector3[] = Array.from({ length: neuralCountClamped }, (_, i) => {
      const u = seededUnit(77, i) * 2 - 1, t = seededUnit(79, i) * Math.PI * 2, r = .26 + seededUnit(83, i) * .24, s = Math.sqrt(1 - u * u);
      return new Vector3(s * Math.cos(t) * r, s * Math.sin(t) * r, u * r);
    });
    const segmentsList: number[] = []; const seeds: number[] = [];
    nodes.forEach((a, i) => { nodes.map((b, j) => ({ j, d: a.distanceTo(b) })).filter(e => e.j > i).sort((x, y) => x.d - y.d).slice(0, 2).forEach(e => { const b = nodes[e.j]!; segmentsList.push(a.x, a.y, a.z, b.x, b.y, b.z); seeds.push(seededUnit(89, i * 7 + e.j), seededUnit(89, i * 7 + e.j)); }); });
    const neuralLines = new BufferGeometry();
    neuralLines.setAttribute('position', new BufferAttribute(new Float32Array(segmentsList), 3));
    neuralLines.setAttribute('aSeed', new BufferAttribute(new Float32Array(seeds), 1));
    const fluxN = Math.max(40, Math.floor(fluxCount / 2));
    const fluxDir = new Float32Array(fluxN * 3), fluxSeed = new Float32Array(fluxN);
    for (let i = 0; i < fluxN; i++) { const t = seededUnit(97, i) * Math.PI * 2, z = (seededUnit(101, i) - .5) * .5; fluxDir[i * 3] = Math.cos(t); fluxDir[i * 3 + 1] = Math.sin(t); fluxDir[i * 3 + 2] = z; fluxSeed[i] = seededUnit(103, i); }
    const flux = new BufferGeometry();
    flux.setAttribute('position', new BufferAttribute(new Float32Array(fluxN * 3), 3));
    flux.setAttribute('aDir', new BufferAttribute(fluxDir, 3)); flux.setAttribute('aSeed', new BufferAttribute(fluxSeed, 1));
    const additive = { transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending } as const;
    return {
      geometry, neuralLines, flux,
      halo: discMaterial('infra', 2.8), core: discMaterial('ice', 3.2, .32), coreGlow: discMaterial('infra', 1.6),
      field: ringMaterial(.985, 1, { ticks: 120, tickAlpha: .18 }), outer: ringMaterial(1.115, 1.12, { ticks: 36, tickAlpha: .3 }),
      orbits: RING_RADII.map((_, i) => ringMaterial(.994, 1, { packets: RING_PACKETS[i]!, ticks: i % 2 ? 0 : 48, tickAlpha: .15 })),
      routing: ringMaterial(.69, .705, { ticks: 72, tickAlpha: 0, colour: 'cognition' }),
      wave: ringMaterial(.5, .507, { colour: 'cognition', accent: 'ice' }),
      conv: ringMaterial(.97, 1, { colour: 'verified', accent: 'platinum' }),
      shell: new ShaderMaterial({ ...additive, vertexShader: SHELL_VERTEX, fragmentShader: SHELL_FRAGMENT, uniforms: { uColour: { value: new Color() }, uAmber: { value: new Color(COLOUR.degraded) }, uLum: { value: 0 }, uNeural: { value: 0 }, uAsym: { value: 0 }, uTime: { value: 0 }, uFracture: { value: 0 } } }),
      scan: new ShaderMaterial({ ...additive, vertexShader: DISC_VERTEX, fragmentShader: SCAN_FRAGMENT, uniforms: { uAngle: { value: 0 }, uAlpha: { value: 0 }, uColour: { value: new Color(COLOUR.verified) } } }),
      neural: new ShaderMaterial({ ...additive, vertexShader: NEURAL_VERTEX, fragmentShader: NEURAL_FRAGMENT, uniforms: { uColour: { value: new Color(COLOUR.cognition) }, uTime: { value: 0 }, uNeural: { value: 0 }, uBase: { value: 0 } } }),
      fluxMaterial: new ShaderMaterial({ ...additive, vertexShader: FLUX_VERTEX, fragmentShader: FLUX_FRAGMENT, uniforms: { uTime: { value: 0 }, uPixel: { value: 1 }, uOuter: { value: 1.5 }, uInner: { value: .2 }, uSpeed: { value: .35 }, uScale: { value: 1 }, uColour: { value: new Color(COLOUR.cognition) }, uAlpha: { value: 0 } } }),
      nucleus: new LineBasicMaterial({ ...additive, color: COLOUR.forge, opacity: 0 }),
      shard: new LineBasicMaterial({ ...additive, color: COLOUR.critical, opacity: 0 }),
      shardGeometry: new EdgesGeometry(new TetrahedronGeometry(.07, 0)),
    };
  }, [segments, fluxCount, neuralCount]);
  useEffect(() => () => {
    Object.values(m.geometry).forEach(g => g.dispose()); m.neuralLines.dispose(); m.flux.dispose(); m.shardGeometry.dispose();
    [m.halo, m.core, m.coreGlow, m.field, m.outer, ...m.orbits, m.routing, m.wave, m.conv, m.shell, m.scan, m.neural, m.fluxMaterial, m.nucleus, m.shard].forEach(material => material.dispose());
  }, [m]);

  useFrame(() => {
    const s = state.current, t = targets, dt = clock.dt;
    const settle = rate(clock, MOTION.dampSettle), slow = rate(clock, MOTION.dampSlow), fast = rate(clock, MOTION.dampFast);
    s.lum = damp(s.lum, t.luminosity, settle, dt); s.rings = damp(s.rings, t.rings, slow, dt); s.orbit = damp(s.orbit, t.orbitSpeed, slow, dt);
    s.indep = damp(s.indep, t.orbitIndependence, slow, dt); s.neural = damp(s.neural, t.neural, settle, dt); s.shell = damp(s.shell, t.shellExpansion, slow, dt);
    s.routing = damp(s.routing, t.routing, settle, dt); s.forge = damp(s.forge, t.forge, settle, dt); s.wave = damp(s.wave, t.waveform, settle, dt);
    s.inflow = damp(s.inflow, t.inflow, settle, dt); s.scan = damp(s.scan, t.scan, settle, dt); s.conv = damp(s.conv, t.convergence, fast, dt);
    s.outflow = damp(s.outflow, t.outflow, settle, dt); s.returnFlow = damp(s.returnFlow, t.returnFlow, settle, dt);
    const arrival = choreo?.current ? sceneChoreography(choreo.current, performance.now(), clock.snap).coreReturn : 0;
    const ambient = t.neural < .1 && !clock.snap ? ambientPulse(performance.now()) : 0;
    s.asym = damp(s.asym, t.asymmetry, slow, dt); s.fracture = damp(s.fracture, t.fracture, settle, dt); s.barrier = damp(s.barrier, t.barrier, settle, dt);
    const lerp = clock.snap ? 1 : 1 - Math.exp(-MOTION.dampSettle * dt);
    colourNow.current.lerp(palette(t.colour), lerp); accentNow.current.lerp(palette(accentOf(t.colour)), lerp);
    const colour = colourNow.current, accent = accentNow.current, step = dt * clock.scale, p = phases.current;

    m.halo.uniforms.uColour.value.copy(colour); m.halo.uniforms.uAlpha.value = .05 + .16 * s.lum + arrival * .08;
    m.coreGlow.uniforms.uColour.value.copy(colour); m.coreGlow.uniforms.uAlpha.value = .12 + .4 * s.lum + s.forge * .15 + arrival * .3;
    m.core.uniforms.uColour.value.copy(accent); m.core.uniforms.uAlpha.value = .25 + .75 * s.lum + arrival * .25;

    p.field += step * .02;
    m.field.uniforms.uAlpha.value = .08 + .12 * s.lum; m.field.uniforms.uArcStart.value = p.field; m.field.uniforms.uArc.value = 1 - .14 * s.asym; m.field.uniforms.uColour.value.set(COLOUR.infra);
    m.outer.uniforms.uAlpha.value = .03 + .06 * s.lum; m.outer.uniforms.uArcStart.value = -p.field * .6; m.outer.uniforms.uGap.value = s.asym;

    RING_RADII.forEach((radius, i) => {
      const visible = Math.max(0, Math.min(1, s.rings - i));
      const direction = i % 2 ? -1 : 1;
      const speed = s.orbit * (.35 + .12 * i) * (1 + s.indep * (i - 2) * .45) * direction;
      p.rings[i]! += step * speed * .5;
      const u = m.orbits[i]!.uniforms;
      u.uAlpha.value = visible * (.06 + .22 * s.lum); u.uPhase.value = p.rings[i]!; u.uColour.value.copy(colour).lerp(palette('silverDim'), .45); u.uAccent.value.copy(accent);
      u.uArc.value = i === 0 ? 1 - .3 * s.asym : 1;
      const ring = rings.current[i];
      if (ring) {
        const [tilt, yaw] = RING_TILT[i]!;
        ring.scale.setScalar(radius * (1 + s.shell * .06 * (i + 1) / 5));
        ring.rotation.set(tilt + Math.sin(clock.t * .3 + i) * .04 * s.asym, yaw + p.rings[i]! * .15, 0);
        ring.position.set(i === 0 ? s.asym * .045 : 0, i === 0 ? -s.asym * .03 : 0, 0);
      }
    });

    const shellU = m.shell.uniforms;
    shellU.uColour!.value.copy(colour); shellU.uLum!.value = s.lum + arrival * .3; shellU.uNeural!.value = s.neural + ambient * .5; shellU.uAsym!.value = s.asym; shellU.uTime!.value = clock.t; shellU.uFracture!.value = s.fracture;
    m.neural.uniforms.uTime!.value = clock.t; m.neural.uniforms.uNeural!.value = s.neural; m.neural.uniforms.uBase!.value = .015 + .07 * s.neural + ambient * .12; m.neural.uniforms.uColour!.value.copy(colour).lerp(palette('ice'), .3);
    if (neuralGroup.current) { neuralGroup.current.rotation.y += step * (.05 + s.neural * .25); neuralGroup.current.rotation.x += step * .02; neuralGroup.current.scale.setScalar(1 + s.shell * .3); }

    p.nucleus += step * (.1 + s.forge * .6);
    if (nucleus.current) { nucleus.current.rotation.set(p.nucleus * .7, p.nucleus, 0); nucleus.current.scale.setScalar(1 + s.forge * .18); }
    m.nucleus.opacity = .08 + s.forge * .55 + s.lum * .1; m.nucleus.color.set(COLOUR.forge).lerp(palette('infra'), 1 - s.forge);

    p.lobe = routeAngle !== undefined ? dampAngle(p.lobe, routeAngle, rate(clock, 3), dt) : p.lobe + step * 1.6 * s.routing;
    const routingU = m.routing.uniforms;
    routingU.uAlpha.value = s.routing * .2; routingU.uTickAlpha.value = s.routing * .35; routingU.uLobe.value = p.lobe; routingU.uLobeAlpha.value = s.routing * 1.4; routingU.uLobeWidth.value = routeAngle !== undefined ? .22 : .5;
    routingU.uColour.value.copy(colour); routingU.uAccent.value.set(COLOUR.ice);

    const amplitude = Math.max(0, Math.min(1, envelopeAmplitude));
    m.wave.uniforms.uAlpha.value = s.wave * (.22 + amplitude * .6); m.wave.uniforms.uWave.value = s.wave; m.wave.uniforms.uWaveAmp.value = amplitude * .09; m.wave.uniforms.uTime.value = clock.t;

    p.scan += step * 1.4;
    m.scan.uniforms.uAngle!.value = p.scan; m.scan.uniforms.uAlpha!.value = s.scan * .55;

    p.conv = (p.conv + step * .45) % 1;
    m.conv.uniforms.uAlpha.value = s.conv * (1 - p.conv) * .7;

    // Flux runs inward for input and verification return, outward while execution energy leaves the Core.
    const outward = s.outflow > Math.max(s.inflow, s.returnFlow);
    const fluxU = m.fluxMaterial.uniforms;
    fluxU.uTime!.value = clock.t; fluxU.uPixel!.value = dpr; fluxU.uScale!.value = 1;
    fluxU.uOuter!.value = outward ? .45 : 1.5; fluxU.uInner!.value = outward ? 1.6 : .2;
    fluxU.uAlpha!.value = Math.max(s.inflow * .75, s.outflow * .5, s.returnFlow * .5, arrival * .6);
    (fluxU.uColour!.value as Color).copy(s.inflow >= Math.max(s.outflow, s.returnFlow) ? palette('cognition') : colour);

    m.shard.opacity = s.fracture * .9;
    if (shards.current) { shards.current.scale.setScalar(1 + s.fracture * .25); shards.current.rotation.z += step * .05; }
    if (group.current) group.current.position.set(position[0], position[1], 0);
  });

  const convRef = useRef<Group>(null);
  useFrame(() => { if (convRef.current) convRef.current.scale.setScalar(1.25 - phases.current.conv * .95); });

  return <group ref={group} position={[position[0], position[1], 0]} scale={scale}>
    <mesh material={m.halo} renderOrder={1}><planeGeometry args={[3.4, 3.4]} /></mesh>
    <mesh material={m.field} geometry={m.geometry.field} renderOrder={2} />
    <mesh material={m.outer} geometry={m.geometry.outer} renderOrder={2} />
    {RING_RADII.map((radius, i) => <group key={radius} ref={el => { rings.current[i] = el; }}><mesh material={m.orbits[i]} geometry={m.geometry.orbit} renderOrder={3} /></group>)}
    <mesh material={m.shell} renderOrder={4}><sphereGeometry args={[.44, 48, 32]} /></mesh>
    <group ref={neuralGroup}><lineSegments geometry={m.neuralLines} material={m.neural} renderOrder={5} frustumCulled={false} /></group>
    <group ref={nucleus}><lineSegments geometry={m.geometry.nucleus} material={m.nucleus} renderOrder={6} /></group>
    <mesh material={m.coreGlow} renderOrder={7}><planeGeometry args={[.9, .9]} /></mesh>
    <mesh material={m.core} renderOrder={8}><planeGeometry args={[.34, .34]} /></mesh>
    <mesh material={m.routing} geometry={m.geometry.routing} renderOrder={6} />
    <mesh material={m.wave} geometry={m.geometry.wave} renderOrder={6} />
    <mesh material={m.scan} renderOrder={9}><planeGeometry args={[2.1, 2.1]} /></mesh>
    <group ref={convRef}><mesh material={m.conv} geometry={m.geometry.conv} renderOrder={9} /></group>
    <points geometry={m.flux} material={m.fluxMaterial} frustumCulled={false} renderOrder={9} />
    <group ref={shards}>{[0, 1, 2, 3, 4].map(i => <lineSegments key={i} geometry={m.shardGeometry} material={m.shard} position={[Math.cos(i * 1.3 + .4) * (.5 + i * .04), Math.sin(i * 1.3 + .4) * (.5 + i * .04), 0]} rotation={[i, i * .7, i * 1.3]} />)}</group>
  </group>;
}
