'use client';
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import type { Group } from 'three';
import { framingTarget, framingTransform } from './camera-composition-policy.ts';
import { damp } from './cosmos/damp.ts';
import { presentationBus } from './presentation-bus.ts';
import { type SpatialLayout } from './spatial-layout-policy.ts';
import type { ChoreographyState } from './transition-choreography.ts';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import type { AudioVisualEnvelope } from '@jarvis/scene';
import type { AgentNode } from './agent-field-policy.ts';
import type { ModelNode, RouteObservation } from './cognition-router-policy.ts';
import type { CoreSystemTargets } from './core-visual-policy.ts';
import type { ExperiencePhase, FlowStage } from './experience-phase-policy.ts';
import type { ForgeVisualPolicy } from './forge-visual-policy.ts';
import { ForgeRenderLoop } from './forge-render-loop.ts';
import type { HealthRegion, RegionHealth } from './telemetry-instrument-policy.ts';
import { COLOUR } from './visual-tokens.ts';
import { CinematicCore } from './cosmos/cinematic-core.tsx';
import { modelShape, modelTint } from './cinematic-palette.ts';
import { Nebula } from './cosmos/nebula.tsx';
import { DriftField } from './cosmos/particle-fields.tsx';
import { CosmosClockProvider, useCosmosClock, useWorld, type World } from './cosmos/runtime.tsx';

export interface ForgeRendererMetrics { fps:number; frameTimeMs:number; drawCalls:number; triangles:number; particleCount:number; quality:string; }

/** Everything the GPU scene may represent. Derived from Kernel projections by pure policies. */
export interface CosmosInput {
  focusModel?: string;
  policy: ForgeVisualPolicy;
  phase: ExperiencePhase;
  /** Request stage expressed spatially (the hero view has no lifecycle strip). */
  stage?: FlowStage;
  core: CoreSystemTargets;
  layout: SpatialLayout;
  models: ModelNode[];
  route?: RouteObservation;
  agents: AgentNode[];
  regions: Record<HealthRegion, RegionHealth>;
  current: boolean;
  staleSince?: number;
  criticalRisk: boolean;
  reducedMotion: boolean;
  choreography: RefObject<ChoreographyState>;
}

/**
 * Subtle compositional framing applied to the scene group and, in the same
 * frame, to the DOM projection layer, so labels never detach from geometry.
 * The far field follows at a fraction for a hint of parallax.
 */
function FramingRig({ phase, layout, world, reduced, children, far }: { phase: ExperiencePhase; layout: SpatialLayout; world: World; reduced: boolean; children: ReactNode; far: ReactNode }) {
  const clock = useCosmosClock();
  const near = useRef<Group>(null), back = useRef<Group>(null);
  const s = useRef({ a: 0, b: 0, s: 1 });
  useEffect(() => () => presentationBus.reset(), []);
  useFrame(() => {
    const target = framingTarget(phase, layout, reduced);
    const goal = framingTransform(target);
    const v = s.current, r = reduced ? Number.POSITIVE_INFINITY : target.rate;
    v.a = damp(v.a, goal.a, r, clock.dt); v.b = damp(v.b, goal.b, r, clock.dt); v.s = damp(v.s, goal.s, r, clock.dt);
    // Critical state only: a very small, slow, controlled instability. Never on degradation.
    const tremor = phase === 'CRITICAL' && !reduced ? Math.sin(performance.now() / 430) * 1.1 + Math.sin(performance.now() / 270) * .6 : 0;
    const a = v.a + tremor, b = v.b;
    const place = (group: Group | null, f: number) => {
      if (!group) return;
      const scale = 1 + (v.s - 1) * f, ax = a * f, by = b * f;
      group.scale.set(scale, scale, 1);
      group.position.set((ax + (scale - 1) * layout.width / 2) * world.k, (-by + (1 - scale) * layout.height / 2) * world.k, 0);
    };
    place(near.current, 1); place(back.current, .35);
    presentationBus.framing(a, b, v.s);
  });
  return <><group ref={back}>{far}</group><group ref={near}>{children}</group></>;
}

const COGNITION: Partial<Record<ExperiencePhase, number>> = { LISTENING: .25, INTERPRETING: .55, THINKING: 1, ROUTING: .85, MODEL_ACTIVE: .75, FALLBACK: .7, RESPONDING: .3, AWARE: .08 };
const GOLD: Partial<Record<ExperiencePhase, number>> = { EXECUTING: 1, APPROVAL: .45, VERIFYING: .3, COMPLETE: .2 };

function RenderClock({fps,hidden}:{fps:number;hidden:boolean}){const advance=useThree(state=>state.advance);useEffect(()=>{if(hidden)return;const host={request:(callback:FrameRequestCallback)=>requestAnimationFrame(callback),cancel:(id:number)=>cancelAnimationFrame(id),now:()=>performance.now()};const loop=new ForgeRenderLoop(host,time=>advance(time,true),fps);loop.start();return()=>loop.stop()},[advance,fps,hidden]);return null}
function Metrics({policy,particles,onMetrics}:{policy:ForgeVisualPolicy;particles:number;onMetrics?:(metrics:ForgeRendererMetrics)=>void}){const gl=useThree(state=>state.gl);const sample=useRef({at:performance.now(),frames:0});useFrame(()=>{if(!onMetrics)return;sample.current.frames++;const now=performance.now();const elapsed=now-sample.current.at;if(elapsed>=500){onMetrics({fps:sample.current.frames*1000/elapsed,frameTimeMs:elapsed/sample.current.frames,drawCalls:gl.info.render.calls,triangles:gl.info.render.triangles,particleCount:particles,quality:policy.quality});sample.current={at:now,frames:0}}});return null}

function Cosmos({ input, envelope, onMetrics }: { input: CosmosInput; envelope: AudioVisualEnvelope; onMetrics?: (metrics: ForgeRendererMetrics) => void }) {
  const { policy, phase, layout } = input;
  const world = useWorld(layout);
  const core = world.toWorld(layout.core);
  const coreRadius = world.radius(layout.coreRadius);
  const cognition = input.current ? COGNITION[phase] ?? 0 : 0;
  const gold = input.current ? GOLD[phase] ?? 0 : 0;
  const execution = world.toWorld(layout.execution.anchor);
  const amplitude = input.current && envelope.observedAt && Date.now() - Date.parse(envelope.observedAt) < 3000 ? envelope.amplitude : 0;
  const coreCount = policy.quality === 'LOW' ? 4500 : policy.quality === 'MEDIUM' ? 10000 : 22000;
  const particles = policy.starCount + policy.particleCount + Math.floor(policy.particleCount / 6) + policy.emberCount + coreCount + Math.floor(coreCount * .5);
  return <CosmosClockProvider motion={policy.motion} current={input.current} {...(input.staleSince !== undefined ? { staleSince: input.staleSince } : {})}>
    <color attach="background" args={[COLOUR.obsidian0]} />
    <Nebula layout={layout} octaves={policy.nebulaOctaves} cyan={cognition} gold={gold} regions={input.regions} luminance={input.current ? 1 : .72} />
    <FramingRig phase={input.current ? phase : 'COMM_LOSS'} layout={layout} world={world} reduced={input.reducedMotion} far={<>
      <DriftField count={policy.starCount} seed={7} spread={[34, 20, 12]} centre={[0, 0, -10]} size={[.5, 1.9]} colour="platinum" accent="ice" alpha={input.current ? .62 : .4} drift={.04} twinkle={.55} />
      <DriftField count={policy.particleCount} seed={91} spread={[22, 12, 7]} centre={[0, 0, -4]} size={[.7, 2]} colour="silverDim" accent="ember" alpha={.16 + gold * .1} drift={.18} twinkle={.3} />
    </>}>
      <DriftField count={Math.floor(policy.particleCount / 6)} seed={53} spread={[14, 8, 2]} centre={[0, 0, 3]} size={[1.2, 3]} colour="infra" accent="cognitionDeep" alpha={.05} drift={.3} twinkle={.2} />
      <DriftField count={policy.emberCount} seed={61} spread={[world.radius(layout.coreRadius) * 2.2, world.radius(layout.coreRadius), 1.5]} centre={[execution[0], execution[1] - .4, -.5]} size={[.9, 2.4]} colour="execution" accent="forge" alpha={.012 + gold * .55} drift={.05} twinkle={.5} rise={.35} riseSpan={2.4} />
      <CinematicCore shape={modelShape(input.focusModel)} position={core} scale={coreRadius} colour={phase === 'CRITICAL' ? COLOUR.critical : phase === 'APPROVAL' ? COLOUR.forge : modelTint(input.focusModel)} energy={cognition + gold} audio={amplitude} count={coreCount}/>
    </FramingRig>
    <Metrics policy={policy} particles={particles} {...(onMetrics ? { onMetrics } : {})} />
    {policy.bloom ? <EffectComposer multisampling={0}><Bloom intensity={.85} luminanceThreshold={.55} luminanceSmoothing={.3} mipmapBlur /></EffectComposer> : null}
  </CosmosClockProvider>;
}

export default function ForgeCanvas({ input, envelope, hidden, onMetrics }: { input: CosmosInput; envelope: AudioVisualEnvelope; hidden: boolean; onMetrics?: (metrics: ForgeRendererMetrics) => void }) {
  const { policy } = input;
  return <Canvas className="forge-canvas" frameloop="never" dpr={policy.dpr} camera={{ position: [0, 0, 9], fov: 48 }} gl={{ antialias: policy.quality !== 'LOW', alpha: false, powerPreference: policy.quality === 'LOW' ? 'low-power' : 'high-performance' }}>
    <RenderClock fps={policy.maxFps} hidden={hidden} />
    <Cosmos input={input} envelope={envelope} {...(onMetrics ? { onMetrics } : {})} />
  </Canvas>;
}
