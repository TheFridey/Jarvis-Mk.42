'use client';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { useReducedMotion } from 'motion/react';
import type { JarvisOperatingPicture, SemanticScene } from '@jarvis/scene';
import type { AgentNode } from './agent-field-policy.ts';
import type { ModelNode, RouteObservation } from './cognition-router-policy.ts';
import { coreSystemTargets } from './core-visual-policy.ts';
import type { DataLiveness, ExperiencePhase, FlowStage } from './experience-phase-policy.ts';
import type { ChoreographyState } from './transition-choreography.ts';
import { nextMeasuredTier, visualPolicy, type ForgeQuality, type ResolvedForgeQuality } from './forge-visual-policy.ts';
import type { CosmosInput, ForgeRendererMetrics } from './forge-cosmos.tsx';
import type { SpatialLayout } from './spatial-layout-policy.ts';
import type { HealthRegion, RegionHealth } from './telemetry-instrument-policy.ts';
import { supportsWebGL } from './webgl-support.ts';
import { audioEnvelopeStore, connectAudioEnvelopeEvents } from './audio-envelope.ts';
import { RendererOverlay } from './renderer-overlay.tsx';

const ForgeCanvas=dynamic(()=>import('./forge-cosmos.tsx'),{ssr:false});
const QUALITY_KEY='jarvis:forge-quality:v1';
function storedQuality():ForgeQuality{try{const value=localStorage.getItem(QUALITY_KEY);return ['AUTO','LOW','MEDIUM','HIGH','ULTRA'].includes(value??'')?value as ForgeQuality:'AUTO'}catch{return'AUTO'}}

export interface GpuEnvironmentProps {
  scene: SemanticScene; picture?: JarvisOperatingPicture; liveness: DataLiveness; phase: ExperiencePhase; layout: SpatialLayout;
  models: ModelNode[]; route?: RouteObservation; agents: AgentNode[]; regions: Record<HealthRegion, RegionHealth>;
  systemDegraded: boolean; criticalRisk: boolean; forceFallback?: boolean;
  stage?: FlowStage; choreography: RefObject<ChoreographyState>;
}

export function GpuEnvironment({scene,picture,liveness,phase,layout,models,route,agents,regions,systemDegraded,criticalRisk,forceFallback=false,stage,choreography}:GpuEnvironmentProps){
  const live=liveness.current;
  const activePicture=live?picture:undefined;
  const reduced=Boolean(useReducedMotion());
  const envelope=useSyncExternalStore(audioEnvelopeStore.subscribe,audioEnvelopeStore.current,audioEnvelopeStore.current);
  const [quality,setQuality]=useState<ForgeQuality>('AUTO');
  useEffect(()=>setQuality(storedQuality()),[]);
  const [measured,setMeasured]=useState<ResolvedForgeQuality>('HIGH');const [hidden,setHidden]=useState(false);const [webgl,setWebgl]=useState<boolean>();const [metrics,setMetrics]=useState<ForgeRendererMetrics>();
  const samples=useRef({direction:0,count:0});
  const lowPower=!live||(activePicture?.systemMode==='AMBIENT'&&activePicture.interactionState==='DORMANT'&&activePicture.workState==='IDLE');
  // Connection degradation is a render overlay, not a Semantic Scene mutation.
  const policy=useMemo(()=>visualPolicy({picture:activePicture,scene,setting:quality,measuredTier:measured,reducedMotion:reduced,lowPower,disconnected:!live}),[activePicture,scene,quality,measured,reduced,lowPower,live]);
  const core=useMemo(()=>coreSystemTargets(phase,systemDegraded),[phase,systemDegraded]);
  const reducedMotion=reduced||policy.motion===0;
  const input=useMemo<CosmosInput>(()=>({policy,phase,...(stage?{stage}:{}),core,layout,models,...(route?{route}:{}),agents,regions,current:live,...(liveness.staleSince!==undefined?{staleSince:liveness.staleSince}:{}),criticalRisk,reducedMotion,choreography}),[policy,phase,stage,core,layout,models,route,agents,regions,live,liveness.staleSince,criticalRisk,reducedMotion,choreography]);
  useEffect(()=>{setWebgl(!forceFallback&&supportsWebGL());const visibility=()=>setHidden(document.hidden);visibility();document.addEventListener('visibilitychange',visibility);return()=>document.removeEventListener('visibilitychange',visibility)},[forceFallback]);
  useEffect(()=>connectAudioEnvelopeEvents(),[]);
  useEffect(()=>{const audio=activePicture?.voiceAudio;const source=audio?.tts==='playing'?'tts':'microphone';const clear=()=>audioEnvelopeStore.publish({schemaVersion:1,source,sequence:Date.now(),observedAt:new Date().toISOString(),amplitude:0,low:0,mid:0,high:0});if(!audio){clear();return;}const age=Date.now()-Date.parse(audio.observedAt);if(!Number.isFinite(age)||age>3000){clear();return;}audioEnvelopeStore.publish({schemaVersion:1,source,sequence:Date.parse(audio.observedAt),observedAt:audio.observedAt,amplitude:source==='tts'?audio.playbackAmplitude:audio.amplitude,low:0,mid:0,high:0});const timer=setTimeout(clear,Math.max(0,3000-age));return()=>clearTimeout(timer);},[activePicture?.voiceAudio]);
  const updateQuality=(value:ForgeQuality)=>{setQuality(value);try{localStorage.setItem(QUALITY_KEY,value)}catch{/* storage is optional presentation state */}};
  const updateMetrics=(value:ForgeRendererMetrics)=>{window.dispatchEvent(new CustomEvent('jarvis:renderer-metrics',{detail:value}));if(process.env.NODE_ENV==='development')setMetrics(value);if(quality!=='AUTO'||policy.state==='IDLE'||reduced||lowPower)return;const direction=value.fps<42?-1:value.fps>57?1:0;if(direction===0){samples.current={direction:0,count:0};return}samples.current=samples.current.direction===direction?{direction,count:samples.current.count+1}:{direction,count:1};if(samples.current.count>=4){setMeasured(current=>nextMeasuredTier(current,value.fps));samples.current={direction:0,count:0}}};
  const freezing=!live&&liveness.staleSince!==undefined;
  return <>
    <div className={`gpu-environment forge-${policy.state.toLowerCase()} phase-${phase.toLowerCase()}${freezing?' comm-loss':''}${!live?' not-current':''}`} data-quality={policy.quality} data-renderer={webgl===false?'fallback':'webgl'} aria-hidden="true">
      {webgl?<ForgeCanvas input={input} envelope={envelope} hidden={hidden} onMetrics={updateMetrics}/>:webgl===false?<StaticCore layout={layout}/>:null}
    </div>
    <label className="quality-control">QUALITY<select aria-label="Forge Cosmos visual quality" value={quality} onChange={event=>updateQuality(event.target.value as ForgeQuality)}>{(['AUTO','LOW','MEDIUM','HIGH','ULTRA'] as const).map(value=><option key={value}>{value}</option>)}</select>{webgl===false?<span className="renderer-fallback-tag">STATIC · NO WEBGL</span>:null}</label>
    {process.env.NODE_ENV==='development'&&metrics?<RendererOverlay metrics={metrics} policy={policy} setting={quality} hidden={hidden}/>:null}
  </>;
}

/** Truthful non-WebGL rendition: static structure only, state carried by the DOM. */
function StaticCore({layout}:{layout:SpatialLayout}){
  const size=layout.coreRadius*2;
  return <div className="forge-fallback"><div className="static-core" style={{left:layout.core.x-size/2,top:layout.core.y-size/2,width:size,height:size}}><i/><i/><i/><b/></div><span style={{top:layout.core.y-layout.coreRadius*1.25-18}}>GPU ENVIRONMENT UNAVAILABLE · STATIC RENDERING</span></div>;
}
