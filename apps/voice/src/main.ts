import { createInterface } from 'node:readline';
import { HttpVoiceKernel } from './kernel-client.ts'; import { VoiceEngine } from './voice-engine.ts'; import { WindowsSpeechInput, WindowsSpeechOutput } from './windows-speech.ts';
import { WakePhraseActivation } from './activation.ts';
const kernel=new HttpVoiceKernel({url:process.env.JARVIS_CORE_URL??'http://127.0.0.1:7420',token:process.env.JARVIS_VOICE_TOKEN??'dev-voice-token',principalId:process.env.JARVIS_VOICE_PRINCIPAL??'principal-operator',nodeId:process.env.JARVIS_NODE_ID??'OFFICE-PC'});
const wakePhrase=process.env.JARVIS_WAKE_PHRASE??'jarvis';const engine=new VoiceEngine({input:new WindowsSpeechInput(),output:new WindowsSpeechOutput(),kernel,wakePhrase,activation:new WakePhraseActivation(wakePhrase),onState:s=>console.log(`[voice] ${s}`)});
await engine.start(); console.log('Voice ready. Say "Jarvis", or use /listen, /ptt, /stop, /device default, /quit.');
const cli=createInterface({input:process.stdin,output:process.stdout});
cli.on('line',(line)=>{void(async()=>{const[value,arg]=line.trim().split(/\s+/,2);if(value==='/listen'||value==='/ptt')await engine.activate(value==='/ptt'?'push-to-talk':'manual');else if(value==='/stop')await engine.deactivate();else if(value==='/device')await engine.switchDevice(arg??'default');else if(value==='/quit'){await engine.stop();process.exit(0)}})().catch(e=>console.error('[voice]',e instanceof Error?e.message:e))});
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void engine.stop().finally(()=>process.exit(0))});
