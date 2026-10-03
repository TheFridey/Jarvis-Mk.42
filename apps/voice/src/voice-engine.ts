import type { VoiceActivationKind, VoiceAudioState, VoicePerceptionEvent } from '@jarvis/contracts';
import type { ActivationStrategy, RecognitionEvent, SpeechInput, SpeechOutput, VoiceKernel } from './contracts.ts';
import type { VoiceMeasurement } from './adapters.ts';
import { BoundedRing } from './ring-buffer.ts';
import { EchoGuard } from './echo-guard.ts';
export type VoiceState='idle'|'listening'|'thinking'|'speaking'|'degraded';
export class VoiceEngine {
 state:VoiceState='idle';private active=false;private runtimeReady=false;private deviceReady=false;
 private processingLatencyMs=0;private droppedObservations=0;private sequence=0;private generation=0;
 private speaking?:AbortController;private pendingSpeechStart=false;private activating?:Promise<void>;private utterances=new Map<number,number>();
 private queue=new BoundedRing<RecognitionEvent>(64);private echo=new EchoGuard();
 private speechStartedAt=0;private responseStartedAt=0;private lostAt=0;private publication?:Promise<void>;private dirty=false;private transcriptTimer?:ReturnType<typeof setTimeout>;
 private audio:VoiceAudioState={observedAt:new Date().toISOString(),wakeConfidence:null,vad:'unknown',amplitude:0,tts:'idle',playbackAmplitude:0,deviceState:'recovering'};
 constructor(private d:{input:SpeechInput;output:SpeechOutput;kernel:VoiceKernel;activation?:ActivationStrategy;wakePhrase?:string;onState?:(s:VoiceState)=>void;onEngaged?:(active:boolean)=>Promise<void>;onMeasurement?:(measurement:VoiceMeasurement)=>void}){}
 async start(){await this.d.input.start(e=>{void this.observe(e).catch(()=>this.set('degraded'));});this.runtimeReady=true;this.deviceReady=true;this.update({deviceState:'ready'});}
 async stop(){this.runtimeReady=false;this.deviceReady=false;this.active=false;this.generation++;if(this.transcriptTimer)clearTimeout(this.transcriptTimer);this.queue.drain();await this.interrupt();await this.d.input.stop();this.update({deviceState:'lost',vad:'unknown',amplitude:0,tts:'idle',partialTranscript:undefined,finalTranscript:undefined});this.set('idle');}
 async activate(kind:VoiceActivationKind='manual',deviceId='default'){
  if(this.active)return;if(this.activating)return this.activating;
  const generation=this.generation;this.activating=(async()=>{const response=await this.send({type:'activation',activation:kind,deviceId});if(generation!==this.generation){await this.send({type:'deactivate',sessionId:''});return;}this.active=true;await this.d.onEngaged?.(true);this.set(response.state==='degraded'?'degraded':'listening');})().finally(()=>{this.activating=undefined;});return this.activating;
 }
 async deactivate(){this.generation++;await this.interrupt();if(this.active)await this.send({type:'deactivate',sessionId:''});this.active=false;await this.d.onEngaged?.(false);this.update({partialTranscript:undefined,finalTranscript:undefined,wakeConfidence:0});this.set('idle');}
 async switchDevice(deviceId:string){this.generation++;await this.interrupt();this.update({deviceState:'recovering'});try{await this.d.input.switchDevice(deviceId);this.deviceReady=true;this.update({deviceState:'ready'});if(this.active){await this.send({type:'device.changed',deviceId});this.set('listening');}}catch(error){this.deviceReady=false;this.update({deviceState:'lost'});this.set('degraded');throw error;}}
 async switchOutputDevice(deviceId:string){this.generation++;await this.interrupt();if(!this.d.output.switchDevice)throw new Error('Output adapter does not support device switching');await this.d.output.switchDevice(deviceId);if(this.active)this.set('listening');}
 diagnostics(){return{ready:this.runtimeReady&&this.state!=='degraded',deviceReady:this.deviceReady,processingLatencyMs:this.processingLatencyMs,droppedObservations:this.droppedObservations};}
 playbackStarted(){if(!this.speaking)return;this.update({tts:'playing'});this.measure('response',this.responseStartedAt);this.responseStartedAt=0;}
 playbackAmplitude(value:number){if(value>0&&!this.speaking)return;if(value>0&&this.responseStartedAt)this.playbackStarted();this.update({playbackAmplitude:Math.max(0,Math.min(1,value)),...(value>0?{tts:'playing' as const}:{})});}
 private measure(name:VoiceMeasurement['name'],start:number){if(start>0)this.d.onMeasurement?.({name,latencyMs:Math.max(0,performance.now()-start),observedAt:new Date().toISOString()});}
 private update(value:Partial<VoiceAudioState>){if(typeof value.partialTranscript==='string'||typeof value.finalTranscript==='string'){if(this.transcriptTimer)clearTimeout(this.transcriptTimer);this.transcriptTimer=setTimeout(()=>this.update({partialTranscript:undefined,finalTranscript:undefined}),15000);this.transcriptTimer.unref();}this.audio={...this.audio,...value,observedAt:new Date().toISOString()};this.dirty=true;if(this.publication)return;this.publication=(async()=>{while(this.dirty){this.dirty=false;try{await this.send({type:'audio.state',state:{...this.audio}});}catch{/* Do not log transcript content. */}}})().finally(()=>{this.publication=undefined;});}
 private async observe(e:RecognitionEvent){const start=performance.now();try{await this.receive(e);}finally{this.processingLatencyMs=performance.now()-start;}}
 private async receive(e:RecognitionEvent){
  this.queue.push(e);
  if(e.type==='observation-dropped'){this.droppedObservations++;return;}
  if(e.type==='audio-state'){this.update({amplitude:e.amplitude??0,vad:e.vad??this.audio.vad});return;}
  if(e.type==='device-lost'){this.lostAt=performance.now();this.deviceReady=false;this.generation++;await this.interrupt();this.update({deviceState:'lost',amplitude:0,vad:'unknown'});this.set('degraded');if(this.active)await this.send({type:'device.lost',deviceId:e.deviceId,sessionId:''});return;}
  if(e.type==='device-ready'){this.deviceReady=true;this.measure('device-recovery',this.lostAt);this.lostAt=0;this.update({deviceState:'ready'});if(this.active){await this.send({type:'device.changed',deviceId:e.deviceId});this.set('listening');}return;}
  if(e.type==='wake'){const started=performance.now();this.update({wakeConfidence:e.confidence??null});await this.activate('wake-phrase',e.deviceId);this.measure('wake',started);return;}
  if(e.type==='speech-start'){
   this.speechStartedAt=performance.now();if(e.utteranceId!==undefined){if(this.utterances.size>=32)this.utterances.delete(this.utterances.keys().next().value!);this.utterances.set(e.utteranceId,this.speechStartedAt);}this.update({vad:'speech'});
   if(this.state==='speaking'||this.state==='thinking'){
    this.pendingSpeechStart=true;
    // A physically qualified AEC source may interrupt from VAD alone.
    if(e.echoCancelled){await this.bargeIn();this.pendingSpeechStart=false;}
   }return;
  }
  if(this.activating&&(e.type==='partial'||e.type==='final'))await this.activating;
  if((this.pendingSpeechStart||this.state==='speaking'||this.state==='thinking')&&e.text&&this.active){if(this.echo.likelySelfAudio(e.text)){if(e.type==='final')this.pendingSpeechStart=false;return;}await this.bargeIn();this.pendingSpeechStart=false;}
  if(e.text&&this.echo.likelySelfAudio(e.text))return;
  if(!this.active){const text=e.text?.trim()??'',phrase=this.d.wakePhrase??'jarvis';const matched=this.d.activation?.matches(e)??(e.type==='final'&&text.toLowerCase().startsWith(phrase.toLowerCase())&&!/[a-z0-9]/i.test(text[phrase.length]??''));if(matched){const start=this.speechStartedAt||performance.now();await this.activate(this.d.activation?.kind??'wake-phrase',e.deviceId);this.update({wakeConfidence:e.confidence??null});this.measure('wake',start);const rest=text.slice(phrase.length).replace(/^[\s.,?!]+/,'');if(rest)await this.final(rest);}return;}
  if(e.type==='partial'&&e.text){this.update({partialTranscript:e.text.slice(0,2048)});await this.send({type:'asr.partial',text:e.text,sequence:++this.sequence,sessionId:''});}
  else if(e.type==='final'&&e.text){const start=e.utteranceId===undefined?this.speechStartedAt:this.utterances.get(e.utteranceId)??0;this.measure('asr',start);if(e.utteranceId!==undefined)this.utterances.delete(e.utteranceId);await this.final(e.text,start);}
  else if(e.type==='silence')this.update({vad:'silence',amplitude:0});
 }
 private async bargeIn(){const start=performance.now();this.generation++;await this.interrupt();this.measure('interruption',start);this.set('listening');await this.send({type:'barge-in',sessionId:''});}
 private async final(text:string,startedAt=this.speechStartedAt){
  const generation=++this.generation,start=startedAt||performance.now();if(this.speaking)await this.interrupt();this.update({partialTranscript:undefined,finalTranscript:text.slice(0,2048)});this.set('thinking');
  try{const response=await this.send({type:'asr.final',text,sequence:++this.sequence,sessionId:''});if(generation!==this.generation||!this.active)return;
   if(response.utterance){this.set('speaking');this.update({tts:'synthesizing'});const controller=new AbortController();this.speaking=controller;this.echo.playbackStarted(response.utterance);this.responseStartedAt=start;await this.d.output.speak(response.utterance,controller.signal);
    if(this.speaking===controller){this.echo.playbackEnded();this.speaking=undefined;this.update({tts:'idle',playbackAmplitude:0});this.set('listening');}
   }else this.set(response.state);
  }catch{if(generation===this.generation){this.echo.playbackEnded();this.set('degraded');}}
 }
 private async send(event:VoicePerceptionEvent){try{return await this.d.kernel.send(event);}catch(error){this.droppedObservations++;throw error;}}
 private async interrupt(){if(this.speaking){this.speaking.abort();this.speaking=undefined;this.echo.playbackEnded();this.update({tts:'cancelled',playbackAmplitude:0});}await this.d.output.stop();}
 private set(s:VoiceState){this.state=s;this.d.onState?.(s);}
 get bufferedFrames(){return this.queue.size;}get echoDiagnostics(){return this.echo.diagnostics;}
}
