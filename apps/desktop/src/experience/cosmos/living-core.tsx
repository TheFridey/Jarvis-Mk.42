'use client';
/**
 * Living Core: an emergent body, not a shell.
 *
 * First-contact revision. The previous version drew a continuous displaced
 * surface, which read as a solid amber bubble with a polygonal silhouette. This
 * version builds the boundary out of light instead:
 *
 *   1. a rim-only haze — the displaced surface survives as a thin fresnel band
 *      with noise-torn alpha, so there is no filled bubble, only a suggestion of
 *      where the body ends;
 *   2. a luminous particle shell — thousands of points on a jittered sphere whose
 *      size and brightness fall off at grazing angles. The boundary is now the
 *      density of particles, which is where it belongs;
 *   3. flowing filaments — Bézier ribbons with travelling pulses, their control
 *      points drifting on slow independent paths, so they read as currents inside
 *      the body rather than planetary rings;
 *   4. a diffuse nucleus — a soft additive core with no wireframe, plus a small
 *      warm point that breathes with energy and measured audio.
 *
 * Everything is GPU-driven from the shared clock, disposed on unmount, and kept
 * mounted across modes so a mode switch never pays a shader compile.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, IcosahedronGeometry, Mesh, ShaderMaterial } from 'three';
import { COLOUR } from '../visual-tokens.ts';
import { NOISE } from './glsl.ts';
import { ribbonGeometry, ribbonMaterial } from './primitives.ts';
import { damp } from './damp.ts';
import { rate, useCosmosClock } from './runtime.tsx';

const HAZE_VERTEX = /* glsl */ `${NOISE}
uniform float uTime; uniform float uEnergy; uniform float uBreath; uniform float uDeform;
varying vec3 vN; varying vec3 vV;
void main(){
  vec3 p = normalize(position);
  float low = fbm(p * 1.6 + vec3(0., uTime * .05, 0.), 2);
  float mid = fbm(p * 4.4 - vec3(uTime * .07, 0., uTime * .04), 3);
  float ridge = sin((p.y * 6.0) + uTime * .35) * .5 + .5;
  float displacement = (low - .5) * .11 + (mid - .5) * .05 + ridge * .015;
  p *= 1. + displacement * uDeform + uBreath * .014 + uEnergy * .012;
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const HAZE_FRAGMENT = /* glsl */ `${NOISE}
uniform vec3 uBody; uniform vec3 uWarm; uniform float uAlpha; uniform float uEnergy; uniform float uTime;
varying vec3 vN; varying vec3 vV;
void main(){
  float facing = clamp(dot(normalize(vN), normalize(vV)), 0., 1.);
  // Only the grazing band survives: no filled surface, no bubble.
  float rim = pow(1. - facing, 3.4);
  float grain = fbm(vN * 5.6 + vec3(uTime * .05), 3);
  float torn = smoothstep(.28, .78, grain);
  float alpha = rim * (.06 + torn * .5) * uAlpha;
  vec3 colour = mix(uBody, uWarm, .18 + torn * .22);
  gl_FragColor = vec4(colour * (.9 + uEnergy * .35), alpha);
}`;

const SHELL_VERTEX = /* glsl */ `
attribute float aSeed;
uniform float uTime; uniform float uPixel; uniform float uEnergy; uniform float uBreath;
varying float vFade; varying float vSeed;
void main(){
  vec3 p = position;
  float swell = 1. + sin(uTime * (.22 + aSeed * .12) + aSeed * 43.) * (.012 + uBreath * .01) + uEnergy * .006;
  p *= swell;
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  vec3 n = normalize(normalMatrix * normalize(position));
  vec3 v = normalize(-mv.xyz);
  // Grazing points dim, so the silhouette is soft rather than cut out.
  float facing = clamp(dot(n, v), 0., 1.);
  vFade = mix(.35, 1., pow(facing, .6)) * (.7 + .3 * sin(uTime * (.5 + aSeed) + aSeed * 90.));
  vSeed = aSeed;
  gl_PointSize = (1.2 + aSeed * 1.8) * uPixel * (9. / max(.5, -mv.z));
  gl_Position = projectionMatrix * mv;
}`;

const SHELL_FRAGMENT = /* glsl */ `
uniform vec3 uCold; uniform vec3 uWarm; uniform float uAlpha; uniform float uEnergy;
varying float vFade; varying float vSeed;
void main(){
  vec2 c = gl_PointCoord * 2. - 1.;
  float r = dot(c, c);
  if (r > 1.) discard;
  vec3 colour = mix(uCold, uWarm, pow(vSeed, 3.));
  float core = pow(max(1. - r, 0.), 2.4);
  gl_FragColor = vec4(colour * (1. + uEnergy * .5), core * vFade * uAlpha);
}`;

export interface LivingCoreProps {
  /** World-space centre on the z=0 plane. */
  position: [number, number];
  /** World-space radius of the body. */
  radius: number;
  /** Body colour, from the same policy that colours the particles. */
  colour: string;
  /** 0..1 — drives brightness, deformation, shell swell and filament speed. */
  energy: number;
  /** 0..1 — measured audio only; 0 when no genuine envelope exists. */
  audio: number;
  quality: 'LOW' | 'MEDIUM' | 'HIGH' | 'ULTRA';
  reduced: boolean;
  /** Kept mounted across modes so switching never recompiles shaders. */
  active?: boolean;
}

const QUALITY = {
  LOW: { detail: 3, shellPoints: 2200, filaments: 2, ribbonSegments: 40 },
  MEDIUM: { detail: 4, shellPoints: 5200, filaments: 3, ribbonSegments: 56 },
  HIGH: { detail: 5, shellPoints: 9000, filaments: 3, ribbonSegments: 72 },
  ULTRA: { detail: 5, shellPoints: 11000, filaments: 4, ribbonSegments: 88 },
} as const;

const seeded = (seed: number, index: number) => { let h = Math.imul(index ^ seed, 0x45d9f3b); h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

/** Evenly distributed spherical shell with radial jitter — the emergent boundary. */
function shellGeometry(count: number): BufferGeometry {
  const positions = new Float32Array(count * 3), seeds = new Float32Array(count);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / Math.max(1, count - 1)) * 2;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    const jitter = .955 + seeded(311, i) * .09;
    positions[i * 3] = Math.cos(theta) * ring * jitter;
    positions[i * 3 + 1] = y * jitter;
    positions[i * 3 + 2] = Math.sin(theta) * ring * jitter;
    seeds[i] = seeded(317, i);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new BufferAttribute(seeds, 1));
  return geometry;
}

export function LivingCore({ position, radius, colour, energy, audio, quality, reduced, active = true }: LivingCoreProps) {
  const clock = useCosmosClock();
  const settings = QUALITY[quality];
  const nucleus = useRef<Mesh>(null);
  const filaments = useRef<Array<Mesh | null>>([]);
  const level = useRef(0);
  const target = useMemo(() => new Color(colour), [colour]);
  const paths = useRef(Array.from({ length: 4 }, (_, index) => ({ phase: seeded(401, index) * Math.PI * 2, speed: .09 + seeded(409, index) * .05, tilt: .35 + seeded(419, index) * 1.1 })));

  const assets = useMemo(() => {
    const hazeGeometry = new IcosahedronGeometry(1, settings.detail);
    const hazeMaterial = new ShaderMaterial({
      vertexShader: HAZE_VERTEX, fragmentShader: HAZE_FRAGMENT,
      transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending,
      uniforms: {
        uTime: { value: 0 }, uEnergy: { value: 0 }, uBreath: { value: 0 }, uDeform: { value: .8 }, uAlpha: { value: 0 },
        uBody: { value: new Color(COLOUR.cognitionDeep) }, uWarm: { value: new Color(COLOUR.forge) },
      },
    });
    const points = shellGeometry(settings.shellPoints);
    const shellMaterial = new ShaderMaterial({
      vertexShader: SHELL_VERTEX, fragmentShader: SHELL_FRAGMENT,
      transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending,
      uniforms: {
        uTime: { value: 0 }, uPixel: { value: 1 }, uEnergy: { value: 0 }, uBreath: { value: 0 }, uAlpha: { value: 0 },
        uCold: { value: new Color(COLOUR.cognition) }, uWarm: { value: new Color(COLOUR.forge) },
      },
    });
    const ribbon = ribbonGeometry(settings.ribbonSegments);
    const ribbons = Array.from({ length: settings.filaments }, () => ribbonMaterial());
    return { hazeGeometry, hazeMaterial, points, shellMaterial, ribbon, ribbons };
  }, [settings.detail, settings.shellPoints, settings.ribbonSegments, settings.filaments]);

  useEffect(() => () => {
    assets.hazeGeometry.dispose(); assets.hazeMaterial.dispose();
    assets.points.dispose(); assets.shellMaterial.dispose();
    assets.ribbons.forEach(material => material.dispose());
  }, [assets]);

  useFrame(() => {
    const dt = clock.dt;
    const settle = rate(clock, 2.2), slow = rate(clock, .6);
    level.current = damp(level.current, energy, settle, dt);
    const energyNow = level.current;
    const breath = Math.sin(clock.t * .55) * (reduced ? 0 : 1);

    const haze = assets.hazeMaterial.uniforms;
    haze.uTime!.value = clock.t;
    haze.uEnergy!.value = energyNow;
    haze.uBreath!.value = breath;
    haze.uAlpha!.value = damp(Number(haze.uAlpha!.value), .62 + energyNow * .45 + audio * .2, settle, dt);
    (haze.uBody!.value as Color).lerp(target, clock.snap ? 1 : 1 - Math.exp(-dt * 1.8));

    const shell = assets.shellMaterial.uniforms;
    shell.uTime!.value = clock.t;
    shell.uEnergy!.value = energyNow;
    shell.uBreath!.value = breath;
    shell.uAlpha!.value = damp(Number(shell.uAlpha!.value), .46 + energyNow * .5 + audio * .12, slow, dt);
    (shell.uCold!.value as Color).lerp(target, clock.snap ? 1 : 1 - Math.exp(-dt * 1.2));

    // Filaments: control points drift on slow, independent arcs inside the body.
    assets.ribbons.forEach((material, index) => {
      const path = paths.current[index] ?? paths.current[0]!;
      const t = clock.t * path.speed + path.phase;
      const reachA = .52 + Math.sin(t * 1.7) * .16;
      const reachB = .5 + Math.cos(t * 1.3 + 1.1) * .18;
      const lift = Math.sin(t * .9) * .3;
      const uniforms = material.uniforms;
      uniforms.uP0.value.set(Math.cos(t) * reachA, Math.sin(t * 1.4 + lift) * reachA * .8, Math.sin(t * .7) * .2);
      uniforms.uP1.value.set(Math.cos(t + 2.1) * .1, Math.sin(t + 1.3) * .18, Math.cos(t * .6) * .28);
      uniforms.uP2.value.set(Math.cos(t + 3.4) * reachB, Math.sin(t * 1.1 + 2.2) * reachB * .75, Math.sin(t * .8 + 1.7) * .22);
      uniforms.uAlpha.value = (.22 + energyNow * .55) * (reduced ? .7 : 1);
      uniforms.uDraw.value = .55 + Math.sin(t * .6) * .35;
      uniforms.uPulse.value = reduced ? 0 : .35 + energyNow * .5;
      uniforms.uPulseCount.value = 1.6;
      uniforms.uPhase.value = (t * .35) % 1;
      uniforms.uTime.value = clock.t;
      uniforms.uWidth.value = .012 + index * .004;
      (uniforms.uColour.value as Color).lerp(target, clock.snap ? 1 : 1 - Math.exp(-dt * 1.4));
    });

    if (nucleus.current) {
      const scale = 1 + energyNow * .14 + audio * .22 + (reduced ? 0 : Math.sin(clock.t * .8) * .02);
      nucleus.current.scale.setScalar(scale);
    }
  });

  return <group position={[position[0], position[1], 0]} scale={radius} visible={active}>
    {/* Emergent boundary: particle density, not a surface. */}
    <points geometry={assets.points} material={assets.shellMaterial} frustumCulled={false} />
    {/* A torn rim of light where the boundary would be. */}
    <mesh geometry={assets.hazeGeometry} material={assets.hazeMaterial} frustumCulled={false} />
    {/* Currents inside the body. */}
    {assets.ribbons.map((material, index) => <mesh key={index} ref={mesh => { filaments.current[index] = mesh; }}
      geometry={assets.ribbon} material={material} frustumCulled={false} />)}
    {/* Diffuse nucleus — no wireframe. */}
    <mesh ref={nucleus}>
      <sphereGeometry args={[.19, 24, 18]} />
      <meshBasicMaterial color={COLOUR.ice} transparent opacity={.3} blending={AdditiveBlending} depthWrite={false} />
    </mesh>
    <mesh scale={.52}>
      <sphereGeometry args={[1, 20, 16]} />
      <meshBasicMaterial color={COLOUR.cognition} transparent opacity={.055} blending={AdditiveBlending} depthWrite={false} />
    </mesh>
    <mesh scale={.4}>
      <sphereGeometry args={[1, 20, 16]} />
      <meshBasicMaterial color={COLOUR.forge} transparent opacity={.035} blending={AdditiveBlending} depthWrite={false} />
    </mesh>
  </group>;
}
