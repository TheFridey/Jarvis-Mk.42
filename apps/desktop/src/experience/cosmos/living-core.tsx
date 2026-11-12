'use client';
/**
 * Living Core envelope: the continuous body the particle field was missing.
 *
 * The Genesis orb read as a galaxy because CinematicCore is a point shell — it
 * has no boundary and no interior. This layer adds the body around the same
 * particles, without replacing them:
 *
 *   1. one displaced shell — a low-frequency vertex deformation gives an organic
 *      silhouette, a fresnel rim carries the edge, and the fragment shader loses
 *      opacity toward the rim so the interior stays readable;
 *   2. two internal filament bands — thin torus knots on separate axes, dim and
 *      additive, so the interior reads as layered structure rather than fog;
 *   3. a restrained nucleus — a small bright core with an edge cage.
 *
 * Everything is GPU-deformed from one uniform clock; no per-frame CPU work, no
 * textures, no post-processing added. Segment and knot densities come from the
 * existing quality tiers, so LOW still fits an integrated GPU. Colours are passed
 * in from the same policy that drives the DOM, so the body can never disagree
 * with the word beside it.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, Color, EdgesGeometry, IcosahedronGeometry, Mesh, ShaderMaterial, TorusKnotGeometry } from 'three';
import { COLOUR } from '../visual-tokens.ts';
import { NOISE } from './glsl.ts';
import { damp } from './damp.ts';
import { rate, useCosmosClock } from './runtime.tsx';

const SHELL_VERTEX = /* glsl */ `${NOISE}
uniform float uTime; uniform float uEnergy; uniform float uBreath; uniform float uDeform;
varying vec3 vN; varying vec3 vV; varying float vRidge;
void main(){
  vec3 p = normalize(position);
  float low = fbm(p * 1.6 + vec3(0., uTime * .05, 0.), 2);
  float mid = fbm(p * 4.4 - vec3(uTime * .07, 0., uTime * .04), 3);
  float ridge = sin((p.y * 6.0) + uTime * .35) * .5 + .5;
  float displacement = (low - .5) * .085 + (mid - .5) * .035 + ridge * .012;
  p *= 1. + displacement * uDeform + uBreath * .012 + uEnergy * .01;
  vRidge = ridge;
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const SHELL_FRAGMENT = /* glsl */ `${NOISE}
uniform vec3 uBody; uniform vec3 uWarm; uniform float uAlpha; uniform float uEnergy; uniform float uTime;
varying vec3 vN; varying vec3 vV; varying float vRidge;
void main(){
  float facing = clamp(dot(normalize(vN), normalize(vV)), 0., 1.);
  float rim = pow(1. - facing, 2.2);
  float veins = smoothstep(.42, .92, fbm(vN * 3.1 + vec3(uTime * .06), 3));
  // A warm band that turns with the body; restrained, never a lens flare.
  float warmBand = smoothstep(.35, .75, sin(vN.y * 5.2 + uTime * .22) * .5 + .5) * .35;
  // Toward the viewer the body warms and brightens, so the centre reads as
  // illuminated matter rather than a hole: a plasma body, not a bubble.
  vec3 colour = mix(uBody, uWarm, clamp(warmBand + veins * .42 + pow(facing, 3.) * .55, 0., 1.));
  float body = pow(facing, 1.4) * (.3 + veins * .34);
  float innerGlow = pow(facing, 4.) * .2;
  float alpha = (rim * .45 + body + innerGlow) * uAlpha;
  gl_FragColor = vec4(colour * (.95 + uEnergy * .3), alpha);
}`;

const FILAMENT_VERTEX = /* glsl */ `
varying vec2 vUv; varying vec3 vPos;
void main(){ vUv = uv; vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`;

const FILAMENT_FRAGMENT = /* glsl */ `
uniform vec3 uColour; uniform float uAlpha; uniform float uTime; uniform float uSpeed;
varying vec2 vUv; varying vec3 vPos;
void main(){
  // Two travelling pulses along the knot; the rest is a dim, flickering thread.
  float flow = fract(vUv.x * 2. - uTime * uSpeed);
  float pulse = smoothstep(.0, .07, flow) * smoothstep(.3, .07, flow);
  float flicker = .55 + .45 * sin(vUv.x * 42. + uTime * 1.4);
  float alpha = (0.085 + pulse * .55) * uAlpha * flicker;
  gl_FragColor = vec4(uColour, alpha);
}`;

export interface LivingCoreProps {
  /** World-space centre on the z=0 plane. */
  position: [number, number];
  /** World-space radius of the shell. */
  radius: number;
  /** Body colour, from the same policy that colours the particles. */
  colour: string;
  /** 0..1 — drives brightness, deformation amplitude and filament speed. */
  energy: number;
  /** 0..1 — measured audio only; 0 when no genuine envelope exists. */
  audio: number;
  quality: 'LOW' | 'MEDIUM' | 'HIGH' | 'ULTRA';
  reduced: boolean;
  /** Kept mounted across modes so switching never recompiles shaders. */
  active?: boolean;
}

const QUALITY = {
  LOW: { detail: 3, shell: 0.55, filaments: 2, knotSegments: 96, tubeSegments: 6 },
  MEDIUM: { detail: 4, shell: 0.8, filaments: 2, knotSegments: 148, tubeSegments: 8 },
  HIGH: { detail: 5, shell: 1, filaments: 3, knotSegments: 200, tubeSegments: 9 },
  ULTRA: { detail: 5, shell: 1.12, filaments: 3, knotSegments: 260, tubeSegments: 10 },
} as const;

export function LivingCore({ position, radius, colour, energy, audio, quality, reduced, active = true }: LivingCoreProps) {
  const clock = useCosmosClock();
  const qualitySettings = QUALITY[quality];
  const shellRef = useRef<Mesh>(null);
  const nucleusRef = useRef<Mesh>(null);
  const filaments = useRef<Array<Mesh | null>>([]);
  const level = useRef(0);
  const target = useMemo(() => new Color(colour), [colour]);

  const assets = useMemo(() => {
    const shellGeometry = new IcosahedronGeometry(1, qualitySettings.detail);
    const shellMaterial = new ShaderMaterial({
      vertexShader: SHELL_VERTEX,
      fragmentShader: SHELL_FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
      uniforms: {
        uTime: { value: 0 }, uEnergy: { value: 0 }, uBreath: { value: 0 }, uDeform: { value: .7 },
        uAlpha: { value: 0 }, uBody: { value: new Color(COLOUR.cognitionDeep) }, uWarm: { value: new Color(COLOUR.forge) },
      },
    });
    const knotGeometry = new TorusKnotGeometry(1, .012, qualitySettings.knotSegments, qualitySettings.tubeSegments, 2, 3);
    const filamentMaterial = new ShaderMaterial({
      vertexShader: FILAMENT_VERTEX,
      fragmentShader: FILAMENT_FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
      uniforms: { uColour: { value: new Color(COLOUR.platinum) }, uAlpha: { value: 0 }, uTime: { value: 0 }, uSpeed: { value: .08 } },
    });
    const nucleusGeometry = new EdgesGeometry(new IcosahedronGeometry(.16, 1));
    return { shellGeometry, shellMaterial, knotGeometry, filamentMaterial, nucleusGeometry };
  }, [qualitySettings.detail, qualitySettings.knotSegments, qualitySettings.tubeSegments]);

  useEffect(() => () => {
    assets.shellGeometry.dispose(); assets.shellMaterial.dispose();
    assets.knotGeometry.dispose(); assets.filamentMaterial.dispose();
    assets.nucleusGeometry.dispose();
  }, [assets]);

  useFrame(() => {
    const dt = clock.dt;
    const settle = rate(clock, 2.2), slow = rate(clock, .7);
    level.current = damp(level.current, energy, settle, dt);
    const shell = assets.shellMaterial.uniforms;
    shell.uTime!.value = clock.t;
    shell.uEnergy!.value = level.current;
    shell.uBreath!.value = Math.sin(clock.t * .55) * (reduced ? 0 : 1);
    shell.uDeform!.value = .7 * qualitySettings.shell;
    shell.uAlpha!.value = damp(Number(shell.uAlpha!.value), .74 + level.current * .26 + audio * .12, settle, dt);
    (shell.uBody!.value as Color).lerp(target, clock.snap ? 1 : 1 - Math.exp(-dt * 1.8));
    const filament = assets.filamentMaterial.uniforms;
    filament.uTime!.value = clock.t;
    filament.uSpeed!.value = .06 + level.current * .34;
    filament.uAlpha!.value = damp(Number(filament.uAlpha!.value), .35 + level.current * .65, slow, dt);
    if (shellRef.current) {
      shellRef.current.rotation.y = clock.t * .035 * (reduced ? 0 : 1);
      shellRef.current.rotation.x = Math.sin(clock.t * .05) * .06 * (reduced ? 0 : 1);
    }
    if (nucleusRef.current) {
      nucleusRef.current.rotation.z = clock.t * .12 * (reduced ? 0 : 1);
      const scale = 1 + level.current * .12 + audio * .18;
      nucleusRef.current.scale.setScalar(scale);
    }
    filaments.current.forEach((mesh, index) => {
      if (!mesh) return;
      const spin = reduced ? 0 : clock.t * (.05 + index * .017) * (1 + level.current);
      mesh.rotation.set(.7 + index * .9, spin, .3 + index * .4);
    });
  });

  return <group position={[position[0], position[1], 0]} scale={radius} visible={active}>
    <mesh ref={shellRef} geometry={assets.shellGeometry} material={assets.shellMaterial} frustumCulled={false} />
    {Array.from({ length: qualitySettings.filaments }, (_, index) => <mesh key={index} ref={mesh => { filaments.current[index] = mesh; }}
      geometry={assets.knotGeometry} material={assets.filamentMaterial} scale={0.42 + index * .14} frustumCulled={false} />)}
    <mesh ref={nucleusRef}>
      <icosahedronGeometry args={[.13, 1]} />
      <meshBasicMaterial color={COLOUR.ice} transparent opacity={.2} blending={AdditiveBlending} depthWrite={false} />
    </mesh>
    <lineSegments geometry={assets.nucleusGeometry}>
      <lineBasicMaterial color={COLOUR.forge} transparent opacity={.42} blending={AdditiveBlending} depthWrite={false} />
    </lineSegments>
    <mesh scale={.44}>
      <sphereGeometry args={[1, 24, 18]} />
      <meshBasicMaterial color={COLOUR.cognition} transparent opacity={.075} blending={AdditiveBlending} depthWrite={false} />
    </mesh>
  </group>;
}
