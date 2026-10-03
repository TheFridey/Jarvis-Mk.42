'use client';
import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, ShaderMaterial, Vector3 } from 'three';
import { seededUnit } from '../forge-visual-policy.ts';
import { COLOUR, MOTION, type SemanticColour } from '../visual-tokens.ts';
import { damp } from './damp.ts';
import { rate, useCosmosClock } from './runtime.tsx';

const POINT_FRAGMENT = /* glsl */ `
uniform vec3 uColour; uniform vec3 uColourB; uniform float uAlpha; uniform float uTwinkle;
varying float vTw; varying float vSeed; varying float vFade;
void main(){vec2 c=gl_PointCoord*2.-1.;float r=dot(c,c);if(r>1.)discard;
  float a=pow(max(1.-r,0.),2.2)*uAlpha*mix(1.,vTw,uTwinkle)*vFade;
  gl_FragColor=vec4(mix(uColour,uColourB,step(.82,vSeed)),a);}`;

const DRIFT_VERTEX = /* glsl */ `
attribute float aSeed; attribute float aSize;
uniform float uTime; uniform float uPixel; uniform float uDrift; uniform float uRise; uniform float uRiseSpan;
varying float vTw; varying float vSeed; varying float vFade;
void main(){
  vec3 p=position;
  p.x+=sin(uTime*.05+aSeed*40.)*uDrift; p.y+=cos(uTime*.043+aSeed*31.)*uDrift;
  vFade=1.;
  if(uRise>0.){float h=fract(aSeed*7.31+uTime*uRise*(.35+aSeed*.65)/uRiseSpan);p.y+=h*uRiseSpan;p.x+=sin(h*6.28+aSeed*20.)*.15;vFade=smoothstep(0.,.15,h)*smoothstep(1.,.6,h);}
  vec4 mv=modelViewMatrix*vec4(p,1.);
  gl_PointSize=aSize*uPixel*(9./max(-mv.z,.5));
  vTw=.55+.45*sin(uTime*(.6+aSeed*2.2)+aSeed*90.);
  vSeed=aSeed;
  gl_Position=projectionMatrix*mv;
}`;

function useDriftField({ count, seed, spread, centre = [0, 0, 0], size }: { count: number; seed: number; spread: [number, number, number]; centre?: [number, number, number]; size: [number, number] }) {
  return useMemo(() => {
    const position = new Float32Array(count * 3), seeds = new Float32Array(count), sizes = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      position[i * 3] = centre[0] + (seededUnit(seed, i * 3) - .5) * spread[0];
      position[i * 3 + 1] = centre[1] + (seededUnit(seed, i * 3 + 1) - .5) * spread[1];
      position[i * 3 + 2] = centre[2] + (seededUnit(seed, i * 3 + 2) - .5) * spread[2];
      seeds[i] = seededUnit(seed + 1, i);
      sizes[i] = size[0] + Math.pow(seededUnit(seed + 2, i), 3) * (size[1] - size[0]);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(position, 3));
    geometry.setAttribute('aSeed', new BufferAttribute(seeds, 1));
    geometry.setAttribute('aSize', new BufferAttribute(sizes, 1));
    return geometry;
  }, [count, seed, spread[0], spread[1], spread[2], centre[0], centre[1], centre[2], size[0], size[1]]);
}

function pointMaterial(vertexShader: string, a: SemanticColour, b: SemanticColour, extra: Record<string, { value: unknown }> = {}) {
  return new ShaderMaterial({
    vertexShader, fragmentShader: POINT_FRAGMENT, transparent: true, depthWrite: false, blending: AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPixel: { value: 1 }, uDrift: { value: 0 }, uRise: { value: 0 }, uRiseSpan: { value: 1 }, uColour: { value: new Color(COLOUR[a]) }, uColourB: { value: new Color(COLOUR[b]) }, uAlpha: { value: 0 }, uTwinkle: { value: .6 }, ...extra },
  });
}

/** One particle family: distant stars, mid dust, foreground micro or forge embers. */
export function DriftField({ count, seed, spread, centre, size, colour, accent, alpha, drift = .2, twinkle = .6, rise = 0, riseSpan = 3 }: { count: number; seed: number; spread: [number, number, number]; centre?: [number, number, number]; size: [number, number]; colour: SemanticColour; accent: SemanticColour; alpha: number; drift?: number; twinkle?: number; rise?: number; riseSpan?: number }) {
  const clock = useCosmosClock();
  const dpr = useThree(state => state.viewport.dpr);
  const geometry = useDriftField({ count, seed, spread, ...(centre ? { centre } : {}), size });
  const material = useMemo(() => pointMaterial(DRIFT_VERTEX, colour, accent), [colour, accent]);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  useFrame(() => {
    const u = material.uniforms;
    u.uTime!.value = clock.t; u.uPixel!.value = dpr; u.uDrift!.value = drift; u.uTwinkle!.value = twinkle; u.uRise!.value = rise; u.uRiseSpan!.value = riseSpan;
    u.uAlpha!.value = damp(u.uAlpha!.value as number, alpha, rate(clock, MOTION.dampSettle), clock.dt);
  });
  return <points geometry={geometry} material={material} frustumCulled={false} />;
}

const GATHER_VERTEX = /* glsl */ `
attribute float aSeed; attribute float aSize; attribute vec3 aDir;
uniform float uTime; uniform float uPixel; uniform vec3 uCore; uniform float uCoreR; uniform float uGather; uniform vec3 uBias;
varying float vTw; varying float vSeed; varying float vFade;
void main(){
  float g=smoothstep(aSeed*.55,aSeed*.55+.45,uGather);
  float ang=uTime*(.15+aSeed*.35)*(.3+g);
  vec3 d=aDir; d.xy=mat2(cos(ang),-sin(ang),sin(ang),cos(ang))*d.xy;
  vec3 target=uCore+d*uCoreR*(1.05+aSeed*1.4)+uBias*aSeed*aSeed;
  vec3 home=position+vec3(sin(uTime*.05+aSeed*40.),cos(uTime*.04+aSeed*20.),0.)*.25;
  vec3 p=mix(home,target,g);
  vec4 mv=modelViewMatrix*vec4(p,1.);
  gl_PointSize=aSize*uPixel*(9./max(-mv.z,.5))*(1.+g*.6);
  vTw=.6+.4*sin(uTime*(1.+aSeed*3.)+aSeed*50.); vSeed=aSeed; vFade=.35+.65*g;
  gl_Position=projectionMatrix*mv;
}`;

/**
 * Cognition particles migrate from the field toward the Core's neural shell
 * while reasoning is observed, and lean toward the model region during routing.
 */
export function CognitionDust({ count, core, coreRadius, gather, bias, alpha }: { count: number; core: [number, number]; coreRadius: number; gather: number; bias: [number, number]; alpha: number }) {
  const clock = useCosmosClock();
  const dpr = useThree(state => state.viewport.dpr);
  const geometry = useMemo(() => {
    const position = new Float32Array(count * 3), dir = new Float32Array(count * 3), seeds = new Float32Array(count), sizes = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      position[i * 3] = (seededUnit(311, i * 3) - .5) * 16; position[i * 3 + 1] = (seededUnit(311, i * 3 + 1) - .5) * 9; position[i * 3 + 2] = (seededUnit(311, i * 3 + 2) - .5) * 4 - 1;
      const u = seededUnit(313, i) * 2 - 1, t = seededUnit(317, i) * Math.PI * 2, s = Math.sqrt(1 - u * u);
      dir[i * 3] = s * Math.cos(t); dir[i * 3 + 1] = s * Math.sin(t); dir[i * 3 + 2] = u * .4;
      seeds[i] = seededUnit(319, i); sizes[i] = .9 + seededUnit(323, i) * 1.6;
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(position, 3)); g.setAttribute('aDir', new BufferAttribute(dir, 3));
    g.setAttribute('aSeed', new BufferAttribute(seeds, 1)); g.setAttribute('aSize', new BufferAttribute(sizes, 1));
    return g;
  }, [count]);
  const material = useMemo(() => pointMaterial(GATHER_VERTEX, 'cognition', 'ice', { uCore: { value: new Vector3() }, uCoreR: { value: 1 }, uGather: { value: 0 }, uBias: { value: new Vector3() } }), []);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  useFrame(() => {
    const u = material.uniforms; const r = rate(clock, MOTION.dampSlow);
    u.uTime!.value = clock.t; u.uPixel!.value = dpr;
    (u.uCore!.value as Vector3).set(core[0], core[1], 0); u.uCoreR!.value = coreRadius;
    u.uGather!.value = damp(u.uGather!.value as number, gather, r, clock.dt);
    const b = u.uBias!.value as Vector3; b.set(damp(b.x, bias[0], r, clock.dt), damp(b.y, bias[1], r, clock.dt), 0);
    u.uAlpha!.value = damp(u.uAlpha!.value as number, alpha, r, clock.dt);
  });
  return <points geometry={geometry} material={material} frustumCulled={false} />;
}
