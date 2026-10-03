import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function wave(pcm: Buffer): Buffer {
  const header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(pcm.length+36,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(16000,24);header.writeUInt32LE(32000,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);return Buffer.concat([header,pcm]);
}
export async function localSpeech(request: {operation:'recognize';audio:string}|{operation:'synthesize';text:string}, signal:AbortSignal):Promise<{text?:string;confidence?:number;audio?:string}> {
  if(process.platform!=='win32')throw new Error('Local RTC speech requires Windows System.Speech');
  const combined=AbortSignal.any([signal,AbortSignal.timeout(25000)]);
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./windows-media.ps1',import.meta.url))],{stdio:'pipe',windowsHide:true,signal:combined});
  return new Promise((resolve,reject)=>{
    let output='';let settled=false;const fail=()=>{if(settled)return;settled=true;child.kill();reject(new Error('Local RTC speech unavailable'));};
    child.stderr.resume();child.on('error',fail);child.stdin.on('error',fail);
    child.stdout.on('data',(chunk:Buffer)=>{output+=chunk.toString();if(output.length>2000000)fail();});
    child.on('close',code=>{if(settled)return;if(code!==0){fail();return;}settled=true;try{resolve(JSON.parse(output));}catch{reject(new Error('Invalid local speech response'));}});
    child.stdin.end(JSON.stringify(request)+'\n');
  });
}
