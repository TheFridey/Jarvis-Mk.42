'use client';
import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import type { AudioVisualEnvelope } from '@jarvis/scene';
import type { AgentNode } from './agent-field-policy.ts';
import type { ModelNode, RouteObservation } from './cognition-router-policy.ts';
import type { CoreSystemTargets } from './core-visual-policy.ts';
import type { ExperiencePhase } from './experience-phase-policy.ts';
import type { ForgeVisualPolicy } from './forge-visual-policy.ts';
import { ForgeRenderLoop } from './forge-render-loop.ts';
import type { SpatialLayout } from './spatial-layout-policy.ts';
import type { HealthRegion, RegionHealth } from './telemetry-instrument-policy.ts';
import { COLOUR } from './visual-tokens.ts';
import { AgentOrbits } from './cosmos/agent-orbits.tsx';
import { CognitionField } from './cosmos/cognition-field.tsx';
import { CoreSystem } from './cosmos/core-system.tsx';
import { ExecutionPath } from './cosmos/execution-path.tsx';
import { Nebula } from './cosmos/nebula.tsx';
import { NeuralWeb } from './cosmos/neural-web.tsx';
import { CognitionDust, DriftField } from './cosmos/particle-fields.tsx';
import { CosmosClockProvider, useWorld } from './cosmos/runtime.tsx';

export interface ForgeRendererMetrics { fps:number; frameTimeMs:number; drawCalls:number; triangles:number; particleCount:number; quality:string; }

/** Everything the GPU scene may represent. Derived from Kernel projections by pure policies. */
export interface CosmosInput {
  policy: ForgeVisualPolicy;
  phase: ExperiencePhase;
  core: CoreSystemTargets;
  layout: SpatialLayout;
  models: ModelNode[];
  route?: RouteObservation;
  agents: AgentNode[];
  regions: Record<HealthRegion, RegionHealth>;
  current: boolean;
  staleSince?: number;
  criticalRisk: boolean;
}

const COGNITION: Partial<Record<ExperiencePhase, number>> = { LISTENING: .25, INTERPRETING: .55, THINKING: 1, ROUTING: .85, MODEL_ACTIVE: .75, FALLBACK: .7, RESPONDING: .3, AWARE: .08 };
const GOLD: Partial<Record<ExperiencePhase, number>> = { EXECUTING: 1, APPROVAL: .45, VERIFYING: .3, COMPLETE: .2 };
const DEG = Math.PI / 180;

function RenderClock({fps,hidden}:{fps:number;hidden:boolean}){const advance=useThree(state=>state.advance);useEffect(()=>{if(hidden)return;const host={request:(callback:FrameRequestCallback)=>requestAnimationFrame(callback),cancel:(id:number)=>cancelAnimationFrame(id),now:()=>performance.now()};const loop=new ForgeRenderLoop(host,time=>advance(time,true),fps);loop.start();return()=>loop.stop()},[advance,fps,hidden]);return null}
function Metrics({policy,particles,onMetrics}:{policy:ForgeVisualPolicy;particles:number;onMetrics?:(metrics:ForgeRendererMetrics)=>void}){const gl=useThree(state=>state.gl);const sample=useRef({at:performance.now(),frames:0});useFrame(()=>{if(!onMetrics)return;sample.current.frames++;const now=performance.now();const elapsed=now-sample.current.at;if(elapsed>=500){onMetrics({fps:sample.current.frames*1000/elapsed,frameTimeMs:elapsed/sample.current.frames,drawCalls:gl.info.render.calls,triangles:gl.info.render.triangles,particleCount:particles,quality:policy.quality});sample.current={at:now,frames:0}}});return null}

function Cosmos({ input, envelope, onMetrics }: { input: CosmosInput; envelope: AudioVisualEnvelope; onMetrics?: (metrics: ForgeRendererMetrics) => void }) {
  const { policy, phase, layout } = input;
  const world = useWorld(layout);
  const core = world.toWorld(layout.core);
  const coreRadius = world.radius(layout.coreRadius);
  const modelPositions = useMemo(() => layout.models.map(point => world.toWorld(point)), [layout, world]);
  const modelById = useMemo(() => new Map(input.models.flatMap((node, i) => modelPositions[i] ? [[node.modelId, modelPositions[i]!] as const] : [])), [input.models, modelPositions]);
  const agentPositions = useMemo(() => layout.agents.map(point => world.toWorld(point)), [layout, world]);
  const selectedIndex = input.models.findIndex(node => node.route === 'SELECTED');
  const routeAngle = selectedIndex >= 0 && layout.models[selectedIndex] ? layout.models[selectedIndex]!.angle * DEG : undefined;
  const cognition = input.current ? COGNITION[phase] ?? 0 : 0;
  const gold = input.current ? GOLD[phase] ?? 0 : 0;
  const routingBias: [number, number] = phase === 'ROUTING' || phase === 'MODEL_ACTIVE' || phase === 'FALLBACK' ? [world.radius(layout.modelRadius) * .55, 0] : [0, 0];
  const execution = world.toWorld(layout.execution.anchor);
  const amplitude = input.current && envelope.observedAt && Date.now() - Date.parse(envelope.observedAt) < 3000 ? envelope.amplitude : 0;
  const particles = policy.starCount + policy.particleCount + Math.floor(policy.particleCount / 6) + policy.emberCount + policy.fluxCount + policy.neuralCount * 2;
  return <CosmosClockProvider motion={policy.motion} current={input.current} {...(input.staleSince !== undefined ? { staleSince: input.staleSince } : {})}>
    <color attach="background" args={[COLOUR.obsidian0]} />
    <Nebula layout={layout} octaves={policy.nebulaOctaves} cyan={cognition} gold={gold} regions={input.regions} luminance={input.current ? 1 : .72} />
    <DriftField count={policy.starCount} seed={7} spread={[34, 20, 12]} centre={[0, 0, -10]} size={[.5, 1.9]} colour="platinum" accent="ice" alpha={input.current ? .62 : .4} drift={.04} twinkle={.55} />
    <DriftField count={policy.particleCount} seed={91} spread={[22, 12, 7]} centre={[0, 0, -4]} size={[.7, 2]} colour="silverDim" accent="ember" alpha={.16 + gold * .1} drift={.18} twinkle={.3} />
    <DriftField count={Math.floor(policy.particleCount / 6)} seed={53} spread={[14, 8, 2]} centre={[0, 0, 3]} size={[1.2, 3]} colour="infra" accent="cognitionDeep" alpha={.05} drift={.3} twinkle={.2} />
    <DriftField count={policy.emberCount} seed={61} spread={[world.radius(layout.coreRadius) * 2.2, world.radius(layout.coreRadius), 1.5]} centre={[execution[0], execution[1] - .4, -.5]} size={[.9, 2.4]} colour="execution" accent="forge" alpha={.012 + gold * .55} drift={.05} twinkle={.5} rise={.35} riseSpan={2.4} />
    <NeuralWeb count={policy.neuralCount} centre={core} spread={coreRadius * 2.1} energy={cognition} />
    <CognitionDust count={Math.floor(policy.particleCount * .6)} core={core} coreRadius={coreRadius * .55} gather={cognition} bias={routingBias} alpha={.12 + cognition * .55} />
    <ExecutionPath phase={phase} core={core} coreRadius={coreRadius} barrier={world.toWorld(layout.execution.barrier)} anchor={execution} k={world.k} fluxCount={policy.fluxCount} criticalRisk={input.criticalRisk} />
    <CognitionField nodes={input.models} positions={modelPositions} core={core} coreRadius={coreRadius} modelRadius={world.radius(layout.modelRadius)} boundary={[world.toWorld(layout.localityBoundary.inner), world.toWorld(layout.localityBoundary.outer)]} {...(input.route ? { route: input.route } : {})} gatewayHealth={input.regions.gateway} k={world.k} current={input.current} />
    <AgentOrbits agents={input.agents} positions={agentPositions} core={core} coreRadius={coreRadius} modelPositions={modelById} k={world.k} />
    <CoreSystem position={core} scale={coreRadius} targets={input.core} {...(routeAngle !== undefined ? { routeAngle } : {})} envelopeAmplitude={amplitude} segments={policy.coreSegments} fluxCount={policy.fluxCount} neuralCount={policy.neuralCount} />
    <Metrics policy={policy} particles={particles} {...(onMetrics ? { onMetrics } : {})} />
    {policy.bloom ? <EffectComposer multisampling={0}><Bloom intensity={.6} luminanceThreshold={.55} luminanceSmoothing={.3} mipmapBlur /></EffectComposer> : null}
  </CosmosClockProvider>;
}

export default function ForgeCanvas({ input, envelope, hidden, onMetrics }: { input: CosmosInput; envelope: AudioVisualEnvelope; hidden: boolean; onMetrics?: (metrics: ForgeRendererMetrics) => void }) {
  const { policy } = input;
  return <Canvas className="forge-canvas" frameloop="never" dpr={policy.dpr} camera={{ position: [0, 0, 9], fov: 48 }} gl={{ antialias: policy.quality !== 'LOW', alpha: false, powerPreference: policy.quality === 'LOW' ? 'low-power' : 'high-performance' }}>
    <RenderClock fps={policy.maxFps} hidden={hidden} />
    <Cosmos input={input} envelope={envelope} {...(onMetrics ? { onMetrics } : {})} />
  </Canvas>;
}
