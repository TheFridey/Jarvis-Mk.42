import { AudioFrame, AudioSource, AudioStream, LocalAudioTrack, Room, RoomEvent, TrackPublishOptions, TrackSource } from '@livekit/rtc-node';
import type { VoiceGateway } from '../voice/voice-gateway.ts';
import { randomUUID } from 'node:crypto';
import { localSpeech, wave } from './local-speech.ts';
import { cloudSpeech } from './cloud-speech.ts';

/** Local media terminates here. No raw audio files or cloud ASR/TTS. */
export async function connectRtcAgent(d:{url:string;token:string;identity:string;sessionId:string;principalId:string;nodeId:string;voice:VoiceGateway;speechMode:'local'|'cloud';onFailure:()=>void}) {
  const speechAdapter=d.speechMode==='cloud'?cloudSpeech:localSpeech;
  const room=new Room();const controller=new AbortController();const source=new AudioSource(16000,1);let generation=0,sequence=0,busy=false;
  let tts:'idle'|'synthesizing'|'playing'='idle',lastAudio=0,publishingAudio=false;
  const voice=(event:Parameters<VoiceGateway['handle']>[0]['event'])=>d.voice.handle({commandId:randomUUID(),principalId:d.principalId,nodeId:d.nodeId,event});
  const publishAudio=(amplitude:number,speech:boolean)=>{if(publishingAudio||Date.now()-lastAudio<200)return;lastAudio=Date.now();publishingAudio=true;void voice({type:'audio.state',sessionId:d.sessionId,state:{observedAt:new Date().toISOString(),wakeConfidence:null,vad:speech?'speech':'silence',amplitude:Math.min(1,amplitude),tts,playbackAmplitude:0,deviceState:'ready'}}).catch(()=>undefined).finally(()=>{publishingAudio=false;});};
  room.on(RoomEvent.TrackSubscribed,(track,_publication,participant)=>{
    if(participant.identity!==d.identity)return;
    void(async()=>{
      const stream=new AudioStream(track,16000,1),reader=stream.getReader();let chunks:Buffer[]=[],samples=0,silence=0,speaking=false;
      try {while(true){
        const read=await reader.read();if(read.done)break;const frame=read.value;
        if(controller.signal.aborted)break;
        const pcm=Buffer.from(frame.data.buffer,frame.data.byteOffset,frame.data.byteLength);let energy=0;for(const value of frame.data)energy+=value*value;
        const speech=Math.sqrt(energy/Math.max(frame.data.length,1))>450;
        publishAudio(Math.sqrt(energy/Math.max(frame.data.length,1))/32768,speech);
        if(speech&&!speaking){speaking=true;generation++;source.clearQueue();void voice({type:'barge-in',sessionId:d.sessionId}).catch(()=>undefined);}
        if(speaking){chunks.push(Buffer.from(pcm));samples+=frame.samplesPerChannel;silence=speech?0:silence+frame.samplesPerChannel;}
        if(speaking&&(silence>=11200||samples>=192000)){
          const audio=Buffer.concat(chunks);chunks=[];samples=0;silence=0;speaking=false;
          if(busy)continue;busy=true;const turn=generation;
          void(async()=>{try{
            const recognized=await speechAdapter({operation:'recognize',audio:wave(audio).toString('base64')},controller.signal);
            if(turn!==generation||!recognized.text?.trim())return;
            const result=await voice({type:'asr.final',sessionId:d.sessionId,sequence:++sequence,text:recognized.text});
            if(turn!==generation||!result.utterance)return;
            tts='synthesizing';const synthesized=await speechAdapter({operation:'synthesize',text:result.utterance},controller.signal);
            if(turn!==generation||!synthesized.audio)return;
            const bytes=Buffer.from(synthesized.audio,'base64');
            for(let offset=0;offset<bytes.length&&turn===generation&&!controller.signal.aborted;offset+=640){
              const block=Buffer.alloc(640);bytes.copy(block,0,offset,Math.min(offset+640,bytes.length));const data=new Int16Array(320);for(let i=0;i<320;i++)data[i]=block.readInt16LE(i*2);
              await source.captureFrame(new AudioFrame(data,16000,1,320));tts='playing';
            }
          }catch{if(!controller.signal.aborted)d.onFailure();}finally{tts='idle';busy=false;}})();
        }
      }}finally{await reader.cancel();reader.releaseLock();}
    })().catch(d.onFailure);
  });
  try {await room.connect(d.url,d.token,{autoSubscribe:true,dynacast:false});const track=LocalAudioTrack.createAudioTrack('jarvis-reply',source);const options=new TrackPublishOptions();options.source=TrackSource.SOURCE_MICROPHONE;await room.localParticipant!.publishTrack(track,options);}
  catch(error){controller.abort();await room.disconnect();await source.close();throw error;}
  return {async close(){controller.abort();generation++;source.clearQueue();await Promise.race([room.disconnect(),new Promise<void>(resolve=>setTimeout(resolve,3000))]);await Promise.race([source.close(),new Promise<void>(resolve=>setTimeout(resolve,3000))]);}};
}
