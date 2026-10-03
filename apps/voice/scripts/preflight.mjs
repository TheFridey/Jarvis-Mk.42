import { spawnSync } from 'node:child_process';
const python=process.env.JARVIS_VOICE_PYTHON??'python';
const probe=spawnSync(python,['-c',"import sys,json,importlib.util; print(json.dumps({'python':'.'.join(map(str,sys.version_info[:3])),'supported':sys.version_info[:2] in [(3,11),(3,12)],'packages':{n:importlib.util.find_spec(n) is not None for n in ['numpy','sounddevice','faster_whisper','silero_vad','kokoro','pvporcupine']}}))"],{encoding:'utf8',windowsHide:true,timeout:15000});
let local=false;
try{const result=JSON.parse(probe.stdout);console.log(JSON.stringify(result,null,2));local=result.supported&&Object.values(result.packages).every(Boolean);}catch{console.log('Local inference Python is unavailable.');}
console.log(`Local ASR model configured: ${Boolean(process.env.JARVIS_ASR_MODEL_PATH)}; Porcupine key configured: ${Boolean(process.env.PICOVOICE_ACCESS_KEY)}. No credentials are printed.`);
console.log('This is dependency presence only. Models, capture, synthesis, acoustic behaviour and latency require qualification.');
if(process.platform==='win32'){
 const speech=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Add-Type -AssemblyName System.Speech; [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | Select-Object Id,@{n='Culture';e={$_.Culture.Name}} | ConvertTo-Json -Compress"],{encoding:'utf8',timeout:15000,windowsHide:true});
 console.log(`Windows fallback recognizers: ${speech.status===0?speech.stdout.trim():'unavailable'}`);
}
if(process.env.JARVIS_VOICE_ADAPTER==='local'&&(!local||!process.env.JARVIS_ASR_MODEL_PATH))process.exitCode=2;
