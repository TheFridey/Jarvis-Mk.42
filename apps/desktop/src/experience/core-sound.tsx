'use client';
import { useEffect, useRef, useState } from 'react';
import type { JarvisOperatingPicture } from '@jarvis/scene';
import { Volume2, VolumeX } from 'lucide-react';
import { JarvisSoundEngine, type JarvisSoundCue } from './sound-engine.ts';

function cueFor(picture?:JarvisOperatingPicture):JarvisSoundCue|undefined {
  if(!picture)return;
  if(picture.systemHealth.overall==='OFFLINE')return'critical';
  if(picture.workState==='ERROR'||picture.workState==='BLOCKED')return'warning';
  if(picture.pendingApprovals.length)return'approval';
  if(picture.workState==='ROUTING')return'routing';
  if(picture.workState==='EXECUTING')return'execution';
  if(picture.workState==='VERIFYING')return'verification';
  if(picture.workState==='COMPLETE')return'complete';
  if(picture.interactionState==='LISTENING')return'listening';
  if(picture.interactionState==='AWARE')return'wake';
}
export function CoreSound({picture,reducedSensory}:{picture?:JarvisOperatingPicture;reducedSensory:boolean}) {
  const [enabled,setEnabled]=useState(false);
  const engine=useRef<JarvisSoundEngine|undefined>(undefined);
  const previous=useRef<string|undefined>(undefined);
  engine.current??=new JarvisSoundEngine();
  const signature=picture?`${picture.interactionState}:${picture.workState}:${picture.systemHealth.overall}:${picture.pendingApprovals.length}`:'';
  useEffect(()=>{if(!enabled||reducedSensory||!signature||signature===previous.current){previous.current=signature;return}previous.current=signature;const cue=cueFor(picture);if(cue)void engine.current?.play(cue,true)},[enabled,picture,reducedSensory,signature]);
  useEffect(()=>()=>{void engine.current?.close()},[]);
  return <button className="sound-control" onClick={()=>setEnabled(current=>!current)} aria-pressed={enabled} aria-label={enabled?'Mute JARVIS sounds':'Enable JARVIS sounds'} disabled={reducedSensory}>{enabled?<Volume2 size={14}/>:<VolumeX size={14}/>} CUES {reducedSensory?'REDUCED':enabled?'ON':'OFF'}</button>;
}
