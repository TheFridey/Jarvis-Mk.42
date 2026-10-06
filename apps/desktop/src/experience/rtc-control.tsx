'use client';
import { useEffect,useRef,useState } from 'react';
import { AudioLines } from 'lucide-react';
import type { Room } from 'livekit-client';
import type { SceneTransport } from './scene-client.ts';
import { startRtcSession } from './rtc-session.ts';

export function RtcControl({transport,available,live}:{transport:SceneTransport;available:boolean;live:boolean}) {
  const [state,setState]=useState<'idle'|'connecting'|'live'>('idle');const [speechMode,setSpeechMode]=useState<'local'|'cloud'>('local');const [error,setError]=useState('');
  const room=useRef<Room|undefined>(undefined);const generation=useRef(0);const audio=useRef<HTMLAudioElement[]>([]);
  const microphone=useRef<MediaStream|undefined>(undefined);
  const release=async()=>{const ended=++generation.current;const previous=room.current;room.current=undefined;microphone.current?.getTracks().forEach(track=>track.stop());microphone.current=undefined;audio.current.forEach(element=>element.remove());audio.current=[];setState('idle');if(previous)await previous.disconnect();if(ended===generation.current)await transport.leaveRtc?.().catch(()=>undefined);};
  useEffect(()=>{if(!live)void release();return()=>{generation.current++;const previous=room.current;room.current=undefined;microphone.current?.getTracks().forEach(track=>track.stop());microphone.current=undefined;void previous?.disconnect();audio.current.forEach(element=>element.remove());audio.current=[];void transport.leaveRtc?.().catch(()=>undefined);};},[transport,live]);
  const toggle=async()=>{
    if(state!=='idle'){await release();return;}setError('');setState('connecting');const turn=++generation.current;
    let captured:MediaStream|undefined;
    try{
      const {Room,RoomEvent,Track}=await import('livekit-client');
      // Obtain permission within the explicit user gesture; no background capture.
      const media=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
      captured=media;
      const track=media.getAudioTracks()[0]!;
      if(turn!==generation.current){media.getTracks().forEach(t=>t.stop());return;}
      microphone.current=media;
      const connection=await transport.joinRtc!(speechMode);
      if(turn!==generation.current){media.getTracks().forEach(t=>t.stop());await transport.leaveRtc?.();return;}
      const current=new Room();room.current=current;
      current.on(RoomEvent.TrackSubscribed,remote=>{if(room.current===current&&turn===generation.current&&remote.kind===Track.Kind.Audio){const element=remote.attach();element.autoplay=true;document.body.appendChild(element);audio.current.push(element);}});
      current.on(RoomEvent.Disconnected,()=>{if(room.current===current)void release();});
      try{const started=await startRtcSession({connect:()=>current.connect(connection.url,connection.token),publish:()=>current.localParticipant.publishTrack(track,{source:Track.Source.Microphone}),startAudio:()=>current.startAudio(),isCurrent:()=>turn===generation.current&&room.current===current,discard:async()=>{media.getTracks().forEach(t=>t.stop());await current.disconnect();}});if(started)setState('live');}
      catch(error){media.getTracks().forEach(t=>t.stop());throw error;}
    }catch{captured?.getTracks().forEach(track=>track.stop());if(turn!==generation.current)return;await release();setError('RTC could not start. Check microphone permission and local media service.');}
  };
  return <div className="rtc-control"><button aria-label={state==='live'?'Stop RTC voice':state==='connecting'?'Cancel RTC connection':'Start RTC voice'} disabled={state==='idle'&&(!live||!available||!transport.joinRtc)} onClick={()=>void toggle()} title={state==='live'?'Microphone live; click to stop':available?'Start a private audio session':'RTC service unavailable'}><AudioLines size={17}/><span>{state==='live'?'MIC LIVE':state==='connecting'?'CONNECTING':''}</span></button><select aria-label="RTC speech processing" value={speechMode} disabled={state!=='idle'} onChange={event=>setSpeechMode(event.target.value as 'local'|'cloud')}><option value="local">LOCAL SPEECH</option><option value="cloud">CLOUD SPEECH</option></select>{error&&<p role="status">{error}</p>}</div>;
}
