'use client';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useReducedMotion } from 'motion/react';
import type { JarvisOperatingPicture, SemanticScene } from '@jarvis/scene';
import { nextMeasuredTier, visualPolicy, type ForgeQuality, type ResolvedForgeQuality } from './forge-visual-policy.ts';
import type { ForgeRendererMetrics } from './forge-cosmos.tsx';
import { supportsWebGL } from './webgl-support.ts';
import { audioEnvelopeStore, connectAudioEnvelopeEvents } from './audio-envelope.ts';

const ForgeCanvas=dynamic(()=>import('./forge-cosmos.tsx'),{ssr:false});
const QUALITY_KEY='jarvis:forge-quality:v1';
function storedQuality():ForgeQuality{try{const value=localStorage.getItem(QUALITY_KEY);return ['AUTO','LOW','MEDIUM','HIGH','ULTRA'].includes(value??'')?value as ForgeQuality:'AUTO'}catch{return'AUTO'}}
export function GpuEnvironment({scene,picture}:{scene:SemanticScene;picture?:JarvisOperatingPicture}){
  const reduced=Boolean(useReducedMotion());
  const envelope=useSyncExternalStore(audioEnvelopeStore.subscribe,audioEnvelopeStore.current,audioEnvelopeStore.current);
  const [quality,setQuality]=useState<ForgeQuality>(()=>typeof localStorage==='undefined'?'AUTO':storedQuality());
  const [measured,setMeasured]=useState<ResolvedForgeQuality>('HIGH');const [hidden,setHidden]=useState(false);const [webgl,setWebgl]=useState<boolean>();const [metrics,setMetrics]=useState<ForgeRendererMetrics>();
  const samples=useRef({direction:0,count:0});
  const lowPower=picture?.systemMode==='AMBIENT'&&picture.interactionState==='DORMANT'&&picture.workState==='IDLE';
  const policy=useMemo(()=>visualPolicy({picture,scene,setting:quality,measuredTier:measured,reducedMotion:reduced,lowPower}),[picture,scene,quality,measured,reduced,lowPower]);
  useEffect(()=>{setWebgl(supportsWebGL());const visibility=()=>setHidden(document.hidden);visibility();document.addEventListener('visibilitychange',visibility);return()=>document.removeEventListener('visibilitychange',visibility)},[]);
  useEffect(()=>connectAudioEnvelopeEvents(),[]);
  const updateQuality=(value:ForgeQuality)=>{setQuality(value);try{localStorage.setItem(QUALITY_KEY,value)}catch{/* storage is optional presentation state */}};
  const updateMetrics=(value:ForgeRendererMetrics)=>{if(process.env.NODE_ENV==='development')setMetrics(value);if(quality!=='AUTO'||policy.state==='IDLE'||reduced||lowPower)return;const direction=value.fps<42?-1:value.fps>57?1:0;if(direction===0){samples.current={direction:0,count:0};return}samples.current=samples.current.direction===direction?{direction,count:samples.current.count+1}:{direction,count:1};if(samples.current.count>=4){setMeasured(current=>nextMeasuredTier(current,value.fps));samples.current={direction:0,count:0}}};
  return <><div className={`gpu-environment forge-${policy.state.toLowerCase()}`} data-quality={policy.quality} data-renderer={webgl===false?'fallback':'webgl'} aria-hidden="true">
    {webgl?<ForgeCanvas scene={scene} picture={picture} envelope={envelope} policy={policy} hidden={hidden} onMetrics={updateMetrics}/>:<div className="forge-fallback"><div/><span>GPU ENVIRONMENT UNAVAILABLE</span></div>}
  </div>
    <label className="quality-control">VISUAL QUALITY<select aria-label="Forge Cosmos visual quality" value={quality} onChange={event=>updateQuality(event.target.value as ForgeQuality)}>{(['AUTO','LOW','MEDIUM','HIGH','ULTRA'] as const).map(value=><option key={value}>{value}</option>)}</select></label>
    {process.env.NODE_ENV==='development'&&metrics?<output className="gpu-diagnostics">GPU · {metrics.fps.toFixed(0)} FPS · {metrics.frameTimeMs.toFixed(1)} MS · {metrics.drawCalls} CALLS · {metrics.triangles.toLocaleString()} TRI · {metrics.particleCount} PARTICLES · {metrics.quality}</output>:null}
  </>
}
