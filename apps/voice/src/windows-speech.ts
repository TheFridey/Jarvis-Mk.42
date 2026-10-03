import{spawn,type ChildProcessWithoutNullStreams}from'node:child_process';import{createInterface}from'node:readline';import{fileURLToPath}from'node:url';import type{RecognitionEvent,SpeechInput,SpeechOutput}from'./contracts.ts';import{parseRecognition}from'./local-sidecar.ts';
export class WindowsSpeechInput implements SpeechInput{
 private child?:ChildProcessWithoutNullStreams;private listener?:(e:RecognitionEvent)=>void;private stopping=false;private retry?:ReturnType<typeof setTimeout>;
 async start(listener:(e:RecognitionEvent)=>void){if(process.platform!=='win32')throw new Error('Windows speech input requires Windows');this.stopping=false;await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{void this.stop();reject(new Error('Windows capture startup timeout'));},15000);this.listener=e=>{if(e.type==='device-ready'){clearTimeout(timer);resolve();}listener(e);};this.spawn();});}
 private spawn(){if(this.stopping||!this.listener)return;const script=fileURLToPath(new URL('../scripts/windows-speech.ps1',import.meta.url));const listener=this.listener;const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script],{stdio:'pipe',windowsHide:true});this.child=child;child.stderr.resume();createInterface({input:child.stdout}).on('line',line=>{try{const e=parseRecognition(JSON.parse(line));if(e)listener(e);}catch{}});const failed=()=>{if(this.stopping||this.child!==child)return;this.child=undefined;listener({type:'device-lost',deviceId:'windows-default'});this.retry=setTimeout(()=>this.spawn(),1000);};child.once('exit',failed);child.once('error',failed);}
 async stop(){this.stopping=true;if(this.retry)clearTimeout(this.retry);this.child?.kill();this.child=undefined}
 async switchDevice(deviceId:string){if(deviceId!=='default'&&deviceId!=='windows-default')throw new Error('Windows System.Speech supports the current default input only');const listener=this.listener;await this.stop();if(listener)await this.start(listener)}
}
export class WindowsSpeechOutput implements SpeechOutput{
 private child?:ChildProcessWithoutNullStreams;
 constructor(private onPlaybackStarted?:()=>void){}
 async speak(text:string,signal:AbortSignal){
  await this.stop();if(signal.aborted)return;
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('../scripts/windows-tts.ps1',import.meta.url))],{stdio:'pipe',windowsHide:true});this.child=child;child.stderr.resume();
  createInterface({input:child.stdout}).on('line',line=>{if(line==='PLAYBACK_STARTED')this.onPlaybackStarted?.();});
  const cancel=()=>{child.kill();};child.stdin.on('error',cancel);signal.addEventListener('abort',cancel,{once:true});
  try{await new Promise<void>((resolve,reject)=>{child.once('exit',code=>code===0||signal.aborted?resolve():reject(new Error('Windows TTS failed')));child.once('error',reject);child.stdin.end(JSON.stringify({text})+'\n');});}
  finally{signal.removeEventListener('abort',cancel);if(this.child===child)this.child=undefined;}
 }
 async stop(){const child=this.child;this.child=undefined;if(child&&!child.killed){await new Promise<void>(resolve=>{const timer=setTimeout(resolve,1000);child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill();});}}
 async switchDevice(id:string){if(id!=='default'&&id!=='windows-default')throw new Error('System.Speech uses the Windows default output; use the local adapter for per-device output');await this.stop();}
}
