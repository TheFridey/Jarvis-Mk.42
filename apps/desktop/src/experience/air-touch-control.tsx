'use client';
import { useEffect,useRef,useState } from 'react';
import type { AirTouchFrame } from '@jarvis/scene';
import type { MediaPipeHandTracker } from '../../../vision/src/mediapipe-tracker.ts';
/** Camera inference remains local; gestures only manipulate the presentation. */
export function AirTouchControl({onReady}:{onReady:()=>void}) {
 const [status,setStatus]=useState('off'),[error,setError]=useState('');
 const generation=useRef(0),stream=useRef<MediaStream|undefined>(undefined),tracker=useRef<MediaPipeHandTracker|undefined>(undefined),raf=useRef(0),video=useRef<HTMLVideoElement|undefined>(undefined);
 const emit=(frame:AirTouchFrame)=>window.dispatchEvent(new CustomEvent('jarvis:air-touch',{detail:frame}));
 const stop=()=>{generation.current++;cancelAnimationFrame(raf.current);stream.current?.getTracks().forEach(t=>t.stop());stream.current=undefined;tracker.current?.close();tracker.current=undefined;if(video.current){video.current.pause();video.current.srcObject=null;}video.current=undefined;emit({phase:'lost',monitorId:'primary',confidence:0,observedAt:new Date().toISOString()});setStatus('off');};
 useEffect(()=>()=>{generation.current++;cancelAnimationFrame(raf.current);stream.current?.getTracks().forEach(t=>t.stop());tracker.current?.close();if(video.current)video.current.srcObject=null;window.dispatchEvent(new CustomEvent('jarvis:air-touch',{detail:{phase:'lost',monitorId:'primary',confidence:0,observedAt:new Date().toISOString()}}));},[]);
 const start=async()=>{
  stop();setError('');setStatus('starting');const turn=generation.current;
  try {
   const media=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720},frameRate:{ideal:24,max:30}},audio:false});
   if(turn!==generation.current){media.getTracks().forEach(t=>t.stop());return;}stream.current=media;
   const element=document.createElement('video');element.muted=true;element.playsInline=true;element.srcObject=media;video.current=element;await element.play();
   const [{MediaPipeHandTracker},{VisionPipeline}]=await Promise.all([import('../../../vision/src/mediapipe-tracker.ts'),import('../../../vision/src/pipeline.ts')]);
   const loaded=await MediaPipeHandTracker.create();if(turn!==generation.current){loaded.close();return;}tracker.current=loaded;
   const pipeline=new VisionPipeline({nodeId:'local-presentation',principalId:'local-presentation',cameraId:'desktop-webcam',model:'MediaPipe 0.10.35',calibration:{camera:{x:0,y:0,width:1,height:1},monitorId:'primary',monitor:{x:0,y:0,width:1920,height:1080},mirrorX:true,quality:.75}});
   media.getVideoTracks()[0]?.addEventListener('ended',()=>{if(turn===generation.current){stop();setError('Camera disconnected. Start Air Touch to reconnect.');}});
   setStatus('tracking');onReady();let last=-1;
   const loop=async(time:number)=>{if(turn!==generation.current)return;try{if(element.readyState>=2&&element.currentTime!==last){last=element.currentTime;const result=await loaded.track(element,time);if(turn!==generation.current)return;for(const command of pipeline.process(result))if(command.signal.type==='air-touch')emit(command.signal.frame);}}catch{if(turn===generation.current){stop();setError('Tracking stopped. Check camera and local vision assets.');}return;}if(turn===generation.current)raf.current=requestAnimationFrame(loop);};
   raf.current=requestAnimationFrame(loop);
  }catch{if(turn===generation.current){stop();setError('Air Touch could not start. Allow camera access on HTTPS or localhost and check the local vision assets.');}}
 };
 return <div className="air-touch-control"><button aria-label={status==='off'?'Start Air Touch':status==='starting'?'Cancel Air Touch':'Stop Air Touch'} aria-pressed={status==='tracking'} onClick={()=>status==='off'?void start():stop()}>AIR TOUCH · {status.toUpperCase()}</button>{status==='tracking'&&<span>Pinch to select / drag · palm to dismiss · swipe to collapse</span>}{error&&<p role="status">{error}</p>}</div>;
}
