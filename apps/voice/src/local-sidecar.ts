import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { RecognitionEvent, SpeechInput, SpeechOutput } from './contracts.ts';
import type { AudioDevice, AudioDeviceManager } from './adapters.ts';

export type LocalCommand =
 | { op: 'start'|'stop'|'devices'|'cancel'|'shutdown' }
 | { op: 'input'|'output'; deviceId: string }
 | { op: 'speak'; text: string }
 | { op: 'engaged'; value: boolean };
const eventTypes = new Set(['speech-start','partial','final','silence','device-lost','device-ready','wake','audio-state','observation-dropped']);
/** Reject raw audio, extra fields, malformed/non-finite derived values at the IPC boundary. */
export function parseRecognition(value: unknown): RecognitionEvent | undefined {
 if (!value || typeof value !== 'object') return;
 const v=value as Record<string,unknown>;
 if (!eventTypes.has(String(v.type)) || typeof v.deviceId !== 'string' || v.deviceId.length>256) return;
 if(Object.keys(v).some(k=>!['type','deviceId','text','durationMs','confidence','amplitude','vad','echoCancelled','observedAt','utteranceId'].includes(k)))return;
 if(v.utteranceId!==undefined&&(!Number.isSafeInteger(v.utteranceId)||Number(v.utteranceId)<0))return;
 if(v.text!==undefined&&(typeof v.text!=='string'||v.text.length>8192))return;
 for(const k of ['confidence','amplitude'])if(v[k]!==undefined&&(typeof v[k]!=='number'||!Number.isFinite(v[k])||Number(v[k])<0||Number(v[k])>1))return;
 for(const k of ['durationMs','observedAt'])if(v[k]!==undefined&&(typeof v[k]!=='number'||!Number.isFinite(v[k])||Number(v[k])<0))return;
 if(v.vad!==undefined&&v.vad!=='speech'&&v.vad!=='silence')return;
 if(v.echoCancelled!==undefined&&typeof v.echoCancelled!=='boolean')return;
 return v as unknown as RecognitionEvent;
}

/** Private inherited stdio, bounded NDJSON. Python receives no Kernel credential. */
export class LocalVoiceSidecar implements SpeechInput, SpeechOutput, AudioDeviceManager {
 private child?: ChildProcessWithoutNullStreams;
 private listener?: (event:RecognitionEvent)=>void;
 private running=false;private engagedState=false;private restartTimer?:ReturnType<typeof setTimeout>;private inputId='default';private outputId='default';
 private id=0;
 private pending=new Map<number,{resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
 constructor(private options:{python?:string;env?:Record<string,string>;onPlayback?:(amplitude:number)=>void}={}){}
 private launch(){
  if(this.child)return;
  const env:NodeJS.ProcessEnv={};
  for(const key of ['PATH','Path','SYSTEMROOT','SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','HOME','APPDATA','LOCALAPPDATA'])if(process.env[key])env[key]=process.env[key];
  Object.assign(env,this.options.env,{PYTHONUNBUFFERED:'1',HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1'});
  const child=spawn(this.options.python??'python',[fileURLToPath(new URL('../sidecar/main.py',import.meta.url))],{stdio:'pipe',windowsHide:true,env});this.child=child;
  let buffer='';
  child.stdout.setEncoding('utf8');child.stdout.on('data',(chunk:string)=>{buffer+=chunk;if(buffer.length>65536){child.kill();return;}let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{this.receive(JSON.parse(line));}catch{/* Never log untrusted inference output. */}}});
  child.stderr.resume();
  const failed=()=>{if(this.child!==child)return;if(!child.killed)child.kill();this.child=undefined;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('Local voice sidecar unavailable'));}this.pending.clear();if(this.running){this.listener?.({type:'device-lost',deviceId:'local-input'});this.restart();}};
  child.stdin.on('error',failed);child.once('error',failed);child.once('exit',failed);
 }
 private restart(){if(!this.running||this.restartTimer)return;this.restartTimer=setTimeout(()=>{this.restartTimer=undefined;if(!this.running)return;void(async()=>{await this.command({op:'input',deviceId:this.inputId},120000);await this.command({op:'output',deviceId:this.outputId});await this.command({op:'engaged',value:this.engagedState});})().catch(()=>this.restart());},2000);this.restartTimer.unref();}
 private receive(message:Record<string,unknown>){
  if(typeof message.id==='number'){const p=this.pending.get(message.id);if(!p)return;this.pending.delete(message.id);clearTimeout(p.timer);if(message.ok===true)p.resolve(message.value);else p.reject(new Error('Local voice operation failed'));return;}
  if(message.kind==='recognition'){const event=parseRecognition(message.event);if(event)this.listener?.(event);}
  if(message.kind==='playback'&&typeof message.amplitude==='number'&&Number.isFinite(message.amplitude))this.options.onPlayback?.(Math.max(0,Math.min(1,message.amplitude)));
 }
 async command(command:LocalCommand,timeoutMs=15000):Promise<unknown>{this.launch();const id=++this.id;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Local voice operation timeout'));},timeoutMs);this.pending.set(id,{resolve,reject,timer});this.child!.stdin.write(JSON.stringify({v:1,id,...command})+'\n');});}
 async start(listener:(event:RecognitionEvent)=>void){this.listener=listener;await this.command({op:'start'},120000);this.running=true;}
 async stop(){this.running=false;if(this.restartTimer)clearTimeout(this.restartTimer);this.restartTimer=undefined;this.listener=undefined;if(!this.child)return;try{await this.command({op:'shutdown'},2000);}finally{this.child?.kill();this.child=undefined;}}
 async switchDevice(id:string){await this.selectInput(id);}
 async selectInput(deviceId:string){await this.command({op:'input',deviceId});this.inputId=deviceId;}
 async selectOutput(deviceId:string){await this.command({op:'output',deviceId});this.outputId=deviceId;}
 async enumerate():Promise<AudioDevice[]>{const devices=await this.command({op:'devices'});if(!Array.isArray(devices)||devices.some(d=>!d||typeof d.id!=='string'||typeof d.name!=='string'||typeof d.input!=='boolean'||typeof d.output!=='boolean'))throw new Error('Invalid audio device inventory');return devices as AudioDevice[];}
 async speak(text:string,signal:AbortSignal){if(signal.aborted)return;const cancel=()=>{void this.command({op:'cancel'},2000).catch(()=>undefined);};signal.addEventListener('abort',cancel,{once:true});try{await this.command({op:'speak',text},120000);}finally{signal.removeEventListener('abort',cancel);}}
 // SpeechOutput.stop must cancel playback without stopping capture.
 async cancelPlayback(){if(this.child)await this.command({op:'cancel'},2000);}
 output:SpeechOutput={speak:(text,signal)=>this.speak(text,signal),stop:()=>this.cancelPlayback(),switchDevice:id=>this.selectOutput(id)};
 async engaged(value:boolean){this.engagedState=value;await this.command({op:'engaged',value});}
}
