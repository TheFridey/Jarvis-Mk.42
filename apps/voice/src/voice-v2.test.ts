import { describe, expect, it, vi } from 'vitest';
import type { VoicePerceptionEvent } from '@jarvis/contracts';
import { VoiceEngine } from './voice-engine.ts';
import { WakePhraseActivation } from './activation.ts';
import { parseRecognition } from './local-sidecar.ts';
import { HttpVoiceKernel } from './kernel-client.ts';
import type { RecognitionEvent, SpeechInput, SpeechOutput, VoiceKernel } from './contracts.ts';
class Input implements SpeechInput {
 listener?:(e:RecognitionEvent)=>void;
 async start(listener:(e:RecognitionEvent)=>void){this.listener=listener;}
 async stop(){} async switchDevice(){}
 emit(event:RecognitionEvent){this.listener?.(event);}
}
const tick=()=>new Promise(r=>setTimeout(r,15));
describe('voice V2 lifecycle and privacy',()=>{
 it('attributes delayed ASR to its own utterance instead of a newer speech onset',async()=>{let clock=100;const now=vi.spyOn(performance,'now').mockImplementation(()=>clock);const input=new Input();const measured:Array<{name:string;latencyMs:number}>=[];const engine=new VoiceEngine({input,output:{async speak(){},async stop(){}},kernel:{async send(){return{sessionId:'s',state:'listening'};}},onMeasurement:m=>measured.push(m)});try{await engine.start();await engine.activate();input.emit({type:'speech-start',deviceId:'m',utteranceId:1});clock=200;input.emit({type:'speech-start',deviceId:'m',utteranceId:2});clock=250;input.emit({type:'final',deviceId:'m',utteranceId:1,text:'first utterance'});expect(measured.find(m=>m.name==='asr')?.latencyMs).toBe(150);await tick();await engine.stop();}finally{now.mockRestore();}});
 it('keeps stopped activation and delayed playback events from reviving the runtime',async()=>{const input=new Input();let release!:()=>void;const events:VoicePerceptionEvent[]=[];const engine=new VoiceEngine({input,output:{async speak(){},async stop(){}},kernel:{async send(e){events.push(e);if(e.type==='activation')await new Promise<void>(r=>{release=r;});return{sessionId:'s',state:'listening'};}}});await engine.start();const activation=engine.activate();await engine.stop();release();await activation;engine.playbackStarted();engine.playbackAmplitude(.9);expect(engine.state).toBe('idle');expect(events.some(e=>e.type==='deactivate')).toBe(true);expect(events.filter(e=>e.type==='audio.state').some(e=>e.type==='audio.state'&&e.state.tts==='playing')).toBe(false);});
 it('keeps dormant hypotheses local and requires a complete wake word',async()=>{
  const input=new Input(),events:VoicePerceptionEvent[]=[];
  const engine=new VoiceEngine({input,output:{async speak(){},async stop(){}},activation:new WakePhraseActivation(),kernel:{async send(e){events.push(e);return{sessionId:'s',state:'listening'};}}});
  await engine.start();input.emit({type:'partial',text:'private dormant conversation',deviceId:'mic'});input.emit({type:'final',text:'jarvisian software',deviceId:'mic'});await tick();
  expect(events.some(e=>e.type==='asr.partial'||e.type==='asr.final'||e.type==='activation')).toBe(false);
  expect(JSON.stringify(events)).not.toContain('private dormant');
  input.emit({type:'final',text:'Jarvis.',deviceId:'mic',confidence:.9});await tick();expect(events.some(e=>e.type==='activation')).toBe(true);await engine.stop();
 });
 it('queues an utterance arriving while wake activation is in flight',async()=>{
  const input=new Input(),events:VoicePerceptionEvent[]=[];let activate!:()=>void;
  const kernel:VoiceKernel={async send(e){events.push(e);if(e.type==='activation')await new Promise<void>(r=>{activate=r;});return{sessionId:'same',state:'listening'};}};
  const engine=new VoiceEngine({input,output:{async speak(){},async stop(){}},kernel});await engine.start();input.emit({type:'wake',deviceId:'mic'});input.emit({type:'final',text:'my first question',deviceId:'mic'});await tick();expect(events.some(e=>e.type==='asr.final')).toBe(false);activate();await tick();expect(events.some(e=>e.type==='asr.final')).toBe(true);await engine.stop();
 });
 it('discards an old response after interruption while retaining the active session',async()=>{
  const input=new Input();let finishOld!:(value:{sessionId:string;state:'speaking';utterance:string})=>void;let calls=0;
  const events:VoicePerceptionEvent[]=[];const speak=vi.fn(async(_text:string,_signal:AbortSignal)=>{});
  const kernel:VoiceKernel={async send(e){events.push(e);if(e.type==='asr.final'){if(++calls===1)return new Promise(r=>{finishOld=r;});return{sessionId:'same',state:'speaking',utterance:'new answer'};}return{sessionId:'same',state:'listening'};}};
  const engine=new VoiceEngine({input,output:{speak,async stop(){}},kernel});await engine.start();await engine.activate();input.emit({type:'final',text:'first question',deviceId:'mic'});await tick();input.emit({type:'speech-start',deviceId:'mic'});input.emit({type:'partial',text:'instead another question',deviceId:'mic'});await tick();input.emit({type:'final',text:'instead another question',deviceId:'mic'});await tick();finishOld({sessionId:'same',state:'speaking',utterance:'old answer'});await tick();
  expect(speak.mock.calls.map(c=>c[0])).toEqual(['new answer']);expect(events.some(e=>e.type==='barge-in')).toBe(true);expect(events.filter(e=>e.type==='activation')).toHaveLength(1);await engine.stop();
 });
 it('cancels qualified AEC speech immediately and restores the same conversation after loss',async()=>{
  const input=new Input();let aborted=false;const events:VoicePerceptionEvent[]=[];
  const output:SpeechOutput={speak:async(_text,signal)=>new Promise<void>(r=>signal.addEventListener('abort',()=>{aborted=true;r();},{once:true})),stop:vi.fn(async()=>{}),switchDevice:vi.fn(async()=>{})};
  const kernel:VoiceKernel={async send(e){events.push(e);return{sessionId:'same',state:'listening',...(e.type==='asr.final'?{utterance:'a long answer'}:{})};}};
  const engine=new VoiceEngine({input,output,kernel});await engine.start();await engine.activate();input.emit({type:'final',text:'question',deviceId:'mic'});await tick();input.emit({type:'speech-start',deviceId:'mic',echoCancelled:true});await tick();expect(aborted).toBe(true);
  input.emit({type:'device-lost',deviceId:'mic'});await tick();expect(engine.state).toBe('degraded');input.emit({type:'device-ready',deviceId:'mic'});await tick();expect(engine.state).toBe('listening');await engine.switchOutputDevice('speaker-2');expect(output.switchDevice).toHaveBeenCalledWith('speaker-2');expect(events.filter(e=>e.type==='activation')).toHaveLength(1);await engine.stop();
 });
 it('rejects raw/oversized or invalid IPC observations',()=>{
  expect(parseRecognition({type:'audio-state',deviceId:'m',amplitude:.4,vad:'speech'})).toBeDefined();
  for(const value of [{type:'final',deviceId:'m',text:'x',pcm:[1,2]},{type:'audio-state',deviceId:'m',amplitude:NaN},{type:'audio-state',deviceId:'m',amplitude:2},{type:'final',deviceId:'m',text:'x'.repeat(8193)},{type:'audio-state',deviceId:'m',echoCancelled:'yes'}])expect(parseRecognition(value)).toBeUndefined();
 });
 it('coalesces authentication and prevents telemetry acknowledgements from overwriting RTC identity',async()=>{
  let authCalls=0;const posted:VoiceEventCommandForTest[]=[];
  const fetcher:typeof fetch=async(url,init)=>{if(String(url).endsWith('/auth/session')){authCalls++;await tick();return new Response(JSON.stringify({accessToken:'test-only',credential:{sessionId:'auth'}}));}const command=JSON.parse(String(init?.body)) as VoiceEventCommandForTest;posted.push(command);return new Response(JSON.stringify({sessionId:command.event.type==='activation'?'rtc':'',state:'listening'}));};
  const client=new HttpVoiceKernel({url:'http://127.0.0.1:7420',bootstrapCredential:'test-only',nodeId:'n',principalId:'p',fetcher});
  await Promise.all([client.send({type:'activation',activation:'manual',deviceId:'m'}),client.send({type:'runtime.health',ready:true,deviceReady:true,processingLatencyMs:0,droppedObservations:0})]);
  await client.send({type:'audio.state',state:{observedAt:'',wakeConfidence:null,vad:'silence',amplitude:0,tts:'idle',playbackAmplitude:0,deviceState:'ready'}});
  expect(authCalls).toBe(1);expect(client.activeSessionId).toBe('rtc');expect(posted.at(-1)?.event.sessionId).toBe('rtc');
 });
});
interface VoiceEventCommandForTest {event:VoicePerceptionEvent}
