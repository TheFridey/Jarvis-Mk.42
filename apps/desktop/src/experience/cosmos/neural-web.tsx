'use client';
import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, ShaderMaterial, Vector3 } from 'three';
import { seededUnit } from '../forge-visual-policy.ts';
import { COLOUR, MOTION } from '../visual-tokens.ts';
import { damp } from './damp.ts';
import { rate, useCosmosClock } from './runtime.tsx';

const VERTEX = /* glsl */ `attribute float aT; attribute float aSeed; varying float vT; varying float vSeed;
void main(){vT=aT;vSeed=aSeed;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const FRAGMENT = /* glsl */ `uniform vec3 uColour; uniform float uTime; uniform float uEnergy; uniform float uIdlePulse;
varying float vT; varying float vSeed;
void main(){float ph=fract(uTime*(.08+vSeed*.25)+vSeed*17.);float pulse=smoothstep(.08,0.,abs(vT-ph));
  float gate=uEnergy+uIdlePulse*step(.93,vSeed);
  float taper=sin(vT*3.14159);
  gl_FragColor=vec4(uColour,(.01+.045*uEnergy+pulse*gate*.5)*taper);}`;

/** Sparse mid-depth filaments: almost invisible at rest; awaken with observed cognition. */
export function NeuralWeb({ count, centre, spread, energy }: { count: number; centre: [number, number]; spread: number; energy: number }) {
  const clock = useCosmosClock();
  const geometry = useMemo(() => {
    const nodes = Array.from({ length: count }, (_, i) => {
      const angle = seededUnit(211, i) * Math.PI * 2, radius = spread * (.35 + Math.sqrt(seededUnit(223, i)) * .95);
      return new Vector3(Math.cos(angle) * radius * 1.5, Math.sin(angle) * radius * .85, -1.5 - seededUnit(227, i) * 3.5);
    });
    const maxEdge = spread * .42;
    const position: number[] = [], t: number[] = [], seeds: number[] = [];
    nodes.forEach((a, i) => nodes.map((b, j) => ({ j, d: a.distanceTo(b) })).filter(e => e.j > i && e.d < maxEdge).sort((x, y) => x.d - y.d).slice(0, 2).forEach(e => {
      const b = nodes[e.j]!; const s = seededUnit(229, i * 31 + e.j);
      position.push(a.x, a.y, a.z, b.x, b.y, b.z); t.push(0, 1); seeds.push(s, s);
    }));
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(position), 3)); g.setAttribute('aT', new BufferAttribute(new Float32Array(t), 1)); g.setAttribute('aSeed', new BufferAttribute(new Float32Array(seeds), 1));
    return g;
  }, [count, spread]);
  const material = useMemo(() => new ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false, blending: AdditiveBlending, uniforms: { uColour: { value: new Color(COLOUR.cognition) }, uTime: { value: 0 }, uEnergy: { value: 0 }, uIdlePulse: { value: .35 } } }), []);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  useFrame(() => {
    material.uniforms.uTime!.value = clock.t;
    material.uniforms.uEnergy!.value = damp(material.uniforms.uEnergy!.value as number, energy, rate(clock, MOTION.dampSlow), clock.dt);
  });
  return <lineSegments geometry={geometry} material={material} position={[centre[0], centre[1], 0]} frustumCulled={false} />;
}
