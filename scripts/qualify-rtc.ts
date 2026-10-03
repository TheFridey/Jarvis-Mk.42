import './local-env.ts';
import {Room,RoomEvent,AudioSource,AudioFrame,LocalAudioTrack,TrackSource,TrackPublishOptions,AudioStream,dispose} from '@livekit/rtc-node';
import {localSpeech} from '../apps/core/src/kernel/rtc/local-speech.ts';
const base='http://127.0.0.1:7420',mode=process.argv.includes('--cloud')?'cloud':'local';
const authResponse=await fetch(base+'/auth/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({credential:process.env.JARVIS_BOOTSTRAP_CREDENTIAL??'dev-bootstrap-secret',nodeId:'local-server',scopes:['voice.write'],surface:'desktop'})});if(!authResponse.ok)throw new Error('RTC qualification authentication failed');
const auth=await authResponse.json() as {accessToken:string;credential:{sessionId:string}};
const headers={authorization:`Bearer ${auth.accessToken}`,'x-jarvis-node-id':'local-server','x-jarvis-session-id':auth.credential.sessionId,'content-type':'application/json'};
const join=await fetch(base+'/rtc/join',{method:'POST',headers,body:JSON.stringify({speechMode:mode})});if(!join.ok)throw new Error(`RTC qualification admission HTTP ${join.status}`);const connection=await join.json() as {url:string;token:string};
const room=new Room(),source=new AudioSource(16000,1);let received=0;const deadline=AbortSignal.timeout(90000);let finish!:()=>void;
const response=new Promise<void>(resolve=>{finish=resolve;});
room.on(RoomEvent.TrackSubscribed,track=>{void(async()=>{const stream=new AudioStream(track,16000,1),reader=stream.getReader();try{while(!deadline.aborted){const value=await reader.read();if(value.done)break;let energy=0;for(const sample of value.value.data)energy+=sample*sample;if(Math.sqrt(energy/Math.max(value.value.data.length,1))>300){received++;if(received>=10){finish();break;}}}}finally{await reader.cancel();reader.releaseLock();}})();});
try{
 await room.connect(connection.url,connection.token,{autoSubscribe:true,dynacast:false});
 if(process.argv.includes('--revoke')){
  const disconnected=new Promise<void>(resolve=>room.once(RoomEvent.Disconnected,()=>resolve()));
  const started=Date.now();const logout=await fetch(base+'/auth/logout',{method:'POST',headers,body:'{}'});
  if(!logout.ok)throw new Error('RTC qualification logout failed');
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{await Promise.race([disconnected,new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error('RTC remained connected after session revocation')),6000);})]);}finally{clearTimeout(timer);}
  console.log(JSON.stringify({scenario:'session-revocation',disconnectedAfterMs:Date.now()-started,physicalMicrophoneVerified:false,status:'PASS'}));
 }else{
 const track=LocalAudioTrack.createAudioTrack('qualification-synthetic-speech',source),options=new TrackPublishOptions();options.source=TrackSource.SOURCE_MICROPHONE;await room.localParticipant!.publishTrack(track,options);
 const generated=await localSpeech({operation:'synthesize',text:'What is two plus two?'},deadline);const bytes=Buffer.concat([Buffer.from(generated.audio!,'base64'),Buffer.alloc(32000)]);
 for(let offset=0;offset<bytes.length;offset+=640){const block=Buffer.alloc(640);bytes.copy(block,0,offset,Math.min(bytes.length,offset+640));const data=new Int16Array(320);for(let i=0;i<320;i++)data[i]=block.readInt16LE(i*2);await source.captureFrame(new AudioFrame(data,16000,1,320));}
 await Promise.race([response,new Promise<void>((_resolve,reject)=>deadline.addEventListener('abort',()=>reject(new Error('No RTC spoken reply within qualification deadline')),{once:true}))]);console.log(JSON.stringify({speechMode:mode,syntheticInput:true,returnedNonSilentFrames:received,physicalMicrophoneVerified:false,status:'PASS'}));
 }
}finally{
 try{
  await fetch(base+'/rtc/leave',{method:'POST',headers,body:'{}',signal:AbortSignal.timeout(5000)}).catch(()=>undefined);
  source.clearQueue();await Promise.race([room.disconnect(),new Promise<void>(resolve=>setTimeout(resolve,3000))]);
  await Promise.race([source.close(),new Promise<void>(resolve=>setTimeout(resolve,3000))]);
  await fetch(base+'/auth/logout',{method:'POST',headers,body:'{}',signal:AbortSignal.timeout(5000)}).catch(()=>undefined);
 }finally{dispose();}
}
