'use client';
import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, ShaderMaterial, Vector2, Vector3 } from 'three';
import type { HealthRegion, RegionHealth } from '../telemetry-instrument-policy.ts';
import type { Point, SpatialLayout } from '../spatial-layout-policy.ts';
import { COLOUR, MOTION } from '../visual-tokens.ts';
import { damp } from './damp.ts';
import { NOISE } from './glsl.ts';
import { rate, useCosmosClock } from './runtime.tsx';

const FRAGMENT = /* glsl */ `
${NOISE}
uniform float uTime; uniform int uOctaves; uniform float uAspect; uniform vec2 uCore; uniform float uCoreR; uniform vec2 uExec;
uniform float uCyan; uniform float uGold; uniform float uLum;
uniform vec3 uSpotA; uniform vec3 uSpotAColour; uniform vec3 uSpotB; uniform vec3 uSpotBColour;
uniform vec3 uObs0; uniform vec3 uObs1; uniform vec3 uCog; uniform vec3 uEmber;
varying vec2 vUv;
float spot(vec2 p, vec3 s){vec2 q=(s.xy-.5)*vec2(uAspect,1.);return exp(-dot(p-q,p-q)*24.)*s.z;}
void main(){
  vec2 p=(vUv-.5)*vec2(uAspect,1.);
  vec2 c=(uCore-.5)*vec2(uAspect,1.);
  float dc=length(p-c);
  vec3 col=mix(uObs1,uObs0,smoothstep(.0,1.1,length(p-c*.6)));
  float n=fbm(vec3(p*1.4,uTime*.012),uOctaves);
  float n2=fbm(vec3(p*3.1+7.,uTime*.018),max(uOctaves-1,1));
  float wisps=smoothstep(.42,.92,n)*.65+smoothstep(.55,.96,n2)*.35;
  float cv=exp(-dc*dc/(uCoreR*uCoreR*7.));
  col+=uCog*(.035+.2*uCyan)*cv*(.45+wisps);
  col+=uCog*.16*wisps*(.25+.45*uCyan)*smoothstep(1.2,.2,dc);
  vec2 e=(uExec-.5)*vec2(uAspect,1.);
  col+=uEmber*(.02+.16*uGold)*exp(-dot(p-e,p-e)*4.)*(.35+wisps);
  float grain=n*.8+.4;
  col+=uSpotAColour*spot(p,uSpotA)*grain*.15+uSpotBColour*spot(p,uSpotB)*grain*.15;
  col*=1.-smoothstep(.5,1.3,length((p-c*.4)*vec2(.8,1.)))*.75;
  col+=(hash13(vec3(gl_FragCoord.xy,uTime))-.5)/255.;
  gl_FragColor=vec4(col*uLum,1.);
}`;
const VERTEX = /* glsl */ `varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,.9999,1.);}`;

const toUv = (point: Point, layout: SpatialLayout) => new Vector2(point.x / layout.width, 1 - point.y / layout.height);

/** Region anchors for localised degradation: the subsystem's place in the composition. */
export function regionAnchor(region: HealthRegion, layout: SpatialLayout): Point {
  const { core, coreRadius, modelRadius, width, height } = layout;
  switch (region) {
    case 'gateway': return { x: core.x + modelRadius, y: core.y };
    case 'fabric': return { x: width * .5, y: height * .92 };
    case 'storage': return { x: width * .86, y: height * .9 };
    case 'cache': return { x: width * .72, y: height * .92 };
    case 'perception': return { x: width * .12, y: height * .16 };
    case 'voice': return { x: core.x, y: core.y + coreRadius * .9 };
  }
}

export function Nebula({ layout, octaves, cyan, gold, regions, luminance }: { layout: SpatialLayout; octaves: number; cyan: number; gold: number; regions: Record<HealthRegion, RegionHealth>; luminance: number }) {
  const clock = useCosmosClock();
  const size = useThree(state => state.size);
  const material = useMemo(() => new ShaderMaterial({
    vertexShader: VERTEX, fragmentShader: FRAGMENT, depthWrite: false, depthTest: false,
    uniforms: {
      uTime: { value: 0 }, uOctaves: { value: 3 }, uAspect: { value: 1.78 }, uCore: { value: new Vector2(.5, .5) }, uCoreR: { value: .2 }, uExec: { value: new Vector2(.3, .3) },
      uCyan: { value: 0 }, uGold: { value: 0 }, uLum: { value: 1 },
      uSpotA: { value: new Vector3() }, uSpotAColour: { value: new Color(COLOUR.degraded) }, uSpotB: { value: new Vector3() }, uSpotBColour: { value: new Color(COLOUR.degraded) },
      uObs0: { value: new Color(COLOUR.obsidian0) }, uObs1: { value: new Color(COLOUR.obsidian2) }, uCog: { value: new Color(COLOUR.cognitionDeep) }, uEmber: { value: new Color(COLOUR.ember) },
    },
  }), []);
  useEffect(() => () => material.dispose(), [material]);
  const spots = (Object.entries(regions) as Array<[HealthRegion, RegionHealth]>).filter(([, health]) => health === 'degraded' || health === 'offline').slice(0, 2);
  useEffect(() => {
    const u = material.uniforms;
    u.uOctaves!.value = octaves;
    u.uAspect!.value = size.width / Math.max(1, size.height);
    u.uCore!.value = toUv(layout.core, layout);
    u.uCoreR!.value = layout.coreRadius / layout.height;
    u.uExec!.value = toUv(layout.execution.anchor, layout);
  }, [material, octaves, size.width, size.height, layout]);
  useFrame(() => {
    const u = material.uniforms; const r = rate(clock, MOTION.dampSlow);
    u.uTime!.value = clock.t;
    u.uCyan!.value = damp(u.uCyan!.value, cyan, r, clock.dt);
    u.uGold!.value = damp(u.uGold!.value, gold, r, clock.dt);
    u.uLum!.value = damp(u.uLum!.value, luminance, r, clock.dt);
    ([['uSpotA', 'uSpotAColour', spots[0]], ['uSpotB', 'uSpotBColour', spots[1]]] as const).forEach(([key, colourKey, entry]) => {
      const target = entry ? toUv(regionAnchor(entry[0], layout), layout) : undefined;
      const value = u[key]!.value as Vector3;
      if (target) value.set(target.x, target.y, damp(value.z, entry![1] === 'offline' ? 1 : .7, r, clock.dt));
      else value.z = damp(value.z, 0, r, clock.dt);
      (u[colourKey]!.value as Color).set(entry?.[1] === 'offline' ? COLOUR.critical : COLOUR.degraded);
    });
  });
  return <mesh frustumCulled={false} renderOrder={-100} material={material}><planeGeometry args={[2, 2]} /></mesh>;
}
