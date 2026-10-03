'use client';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group, RingGeometry } from 'three';
import type { AgentNode, AgentNodeState } from '../agent-field-policy.ts';
import { MOTION, type SemanticColour } from '../visual-tokens.ts';
import { damp } from './damp.ts';
import { discMaterial, palette, ribbonGeometry, ribbonMaterial, ringMaterial } from './primitives.ts';
import { rate, useCosmosClock } from './runtime.tsx';

export const AGENT_COLOUR: Record<AgentNodeState, SemanticColour> = { WORKING: 'cognition', LEASED: 'ice', QUEUED: 'infra', WAITING: 'infra', BLOCKED: 'degraded', COMPLETE: 'verified', FAILED: 'degraded', CANCELLED: 'silverDim', UNCONFIRMED: 'silverDim' };

function AgentOrbit({ agent, at, core, coreRadius, parent, model, k }: { agent: AgentNode; at: [number, number]; core: [number, number]; coreRadius: number; parent?: [number, number]; model?: [number, number]; k: number }) {
  const clock = useCosmosClock();
  const group = useRef<Group>(null), satellite = useRef<Group>(null);
  const m = useMemo(() => ({ tether: ribbonMaterial(), parent: ribbonMaterial(), model: ribbonMaterial(), halo: discMaterial('cognition', 2.6, .22), ring: ringMaterial(.78, 1, { ticks: 4, tickAlpha: .7 }), geometry: new RingGeometry(.78, 1, 48, 1), sat: discMaterial('ice', 1.5, .3) }), []);
  useEffect(() => () => { [m.tether, m.parent, m.model, m.halo, m.ring, m.sat].forEach(x => x.dispose()); m.geometry.dispose(); }, [m]);
  const s = useRef({ x: at[0], y: at[1], energy: 0, draw: 0, phase: 0, orbit: 0 });
  const colour = AGENT_COLOUR[agent.state];
  const active = agent.state !== 'COMPLETE' && agent.state !== 'CANCELLED' && agent.state !== 'FAILED';
  useFrame(() => {
    const v = s.current, dt = clock.dt, settle = rate(clock, MOTION.dampSettle);
    v.x = damp(v.x, at[0], settle, dt); v.y = damp(v.y, at[1], settle, dt);
    v.energy = damp(v.energy, agent.animated ? 1 : active ? .45 : .22, settle, dt);
    v.draw = damp(v.draw, active ? 1 : 0, rate(clock, 1.4), dt);
    v.phase += dt * clock.scale * (agent.animated ? .6 : 0);
    v.orbit += dt * clock.scale * (agent.animated ? 1.4 : 0);
    const r = 10 * k;
    if (group.current) { group.current.position.set(v.x, v.y, .1); group.current.scale.setScalar(r); group.current.rotation.z = Math.PI / 4; }
    if (satellite.current) { satellite.current.position.set(Math.cos(v.orbit) * 1.7, Math.sin(v.orbit) * 1.7, 0); satellite.current.visible = agent.animated; }
    const lerp = 1 - Math.exp(-4 * dt);
    m.halo.uniforms.uColour.value.lerp(palette(colour), lerp); m.halo.uniforms.uAlpha.value = v.energy * .45;
    m.ring.uniforms.uColour.value.lerp(palette(colour === 'cognition' ? 'ice' : colour), lerp); m.ring.uniforms.uAlpha.value = .15 + v.energy * .4; m.ring.uniforms.uGap.value = agent.state === 'UNCONFIRMED' ? 1 : 0;
    m.sat.uniforms.uAlpha.value = agent.animated ? .9 : 0;
    const dx = v.x - core[0], dy = v.y - core[1], len = Math.hypot(dx, dy) || 1;
    const tu = m.tether.uniforms;
    tu.uP0.value.set(core[0] + dx / len * coreRadius * .95, core[1] + dy / len * coreRadius * .95, 0); tu.uP2.value.set(v.x - dx / len * r * 1.5, v.y - dy / len * r * 1.5, 0);
    tu.uP1.value.set((tu.uP0.value.x + tu.uP2.value.x) / 2 + dy / len * len * .08, (tu.uP0.value.y + tu.uP2.value.y) / 2 - dx / len * len * .08, 0);
    tu.uWidth.value = k * 1.3; tu.uDraw.value = v.draw; tu.uAlpha.value = v.energy * .4; tu.uPulse.value = agent.animated ? .9 : 0; tu.uPhase.value = v.phase; tu.uPulseCount.value = 2; tu.uDash.value = agent.state === 'QUEUED' ? 1 : 0;
    tu.uColour.value.copy(palette(colour)); tu.uPulseColour.value.copy(palette('ice'));
    const link = (u: typeof tu, target?: [number, number], alpha = .25) => {
      if (!target) { u.uAlpha.value = 0; return; }
      u.uP0.value.set(v.x, v.y, 0); u.uP2.value.set(target[0], target[1], 0); u.uP1.value.set((v.x + target[0]) / 2, (v.y + target[1]) / 2 + len * .12, 0);
      u.uWidth.value = k * 1.1; u.uDraw.value = v.draw; u.uAlpha.value = alpha * v.energy; u.uDash.value = 1; u.uPulse.value = agent.animated ? .6 : 0; u.uPhase.value = v.phase * .7; u.uColour.value.copy(palette('cognition')); u.uPulseColour.value.copy(palette('ice'));
    };
    link(m.parent.uniforms, parent, .3); link(m.model.uniforms, agent.animated ? model : undefined, .22);
  });
  return <>
    <mesh geometry={ribbonGeometry(48)} material={m.tether} frustumCulled={false} renderOrder={10} />
    <mesh geometry={ribbonGeometry(48)} material={m.parent} frustumCulled={false} renderOrder={10} />
    <mesh geometry={ribbonGeometry(48)} material={m.model} frustumCulled={false} renderOrder={10} />
    <group ref={group}>
      <mesh material={m.halo} renderOrder={11}><planeGeometry args={[3, 3]} /></mesh>
      <mesh material={m.ring} geometry={m.geometry} renderOrder={12} />
      <group ref={satellite}><mesh material={m.sat} renderOrder={12}><planeGeometry args={[.6, .6]} /></mesh></group>
    </group>
  </>;
}

export function AgentOrbits({ agents, positions, core, coreRadius, modelPositions, k }: { agents: AgentNode[]; positions: Array<[number, number]>; core: [number, number]; coreRadius: number; modelPositions: Map<string, [number, number]>; k: number }) {
  const byId = new Map(agents.map((agent, i) => [agent.agentId, positions[i]]));
  return <group>{agents.map((agent, i) => positions[i] ? <AgentOrbit key={agent.agentId} agent={agent} at={positions[i]!} core={core} coreRadius={coreRadius} k={k} {...(agent.parentAgentId && byId.get(agent.parentAgentId) ? { parent: byId.get(agent.parentAgentId)! } : {})} {...(agent.modelId && modelPositions.get(agent.modelId) ? { model: modelPositions.get(agent.modelId)! } : {})} /> : null)}</group>;
}
