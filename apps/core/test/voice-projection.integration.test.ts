import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {isDockerAvailable} from '@jarvis/testkit';
import {setupIt,truncateAll,type ItContext} from './it-harness.ts';
const dockerOk=await isDockerAvailable();
describe.skipIf(!dockerOk)('authenticated voice projection',()=>{
 let ctx:ItContext;
 beforeAll(async()=>{ctx=await setupIt();await truncateAll(ctx.pg);});afterAll(()=>ctx?.cleanup());
 it('requires bound voice scope, projects real derived state and rejects PCM',async()=>{
  const k=ctx.makeKernel({noHttp:false});await k.start();
  try{
   const base=`http://${k.config.diagnosticsHost}:${k.diagnosticsPort}`;
   const state={observedAt:'client-clock',wakeConfidence:.8,vad:'speech',amplitude:.35,tts:'playing',playbackAmplitude:.25,deviceState:'ready'};
   const command={commandId:'audio',principalId:'principal-operator',nodeId:k.config.nodeId,event:{type:'audio.state',state}};
   const post=(headers:Record<string,string>,body=command)=>fetch(`${base}/voice/events`,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
   expect((await post({})).status).toBe(401);
   const exchange=await fetch(`${base}/auth/session`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({credential:k.config.bootstrapCredential,nodeId:k.config.nodeId,scopes:['voice.write','desktop.read'],surface:'voice'})});expect(exchange.status).toBe(201);
   const issued=await exchange.json() as {accessToken:string;credential:{sessionId:string}};
   const headers={authorization:`Bearer ${issued.accessToken}`,'x-jarvis-node-id':k.config.nodeId,'x-jarvis-session-id':issued.credential.sessionId};
   expect((await post(headers,{...command,principalId:'forged-principal'})).status).toBe(403);
   expect((await post(headers)).status).toBe(200);
   const snapshot=await(await fetch(`${base}/desktop/snapshot`,{headers})).json() as {voiceAudio:typeof state;interactionState:string};
   expect(snapshot.voiceAudio).toMatchObject({amplitude:.35,playbackAmplitude:.25,tts:'playing'});expect(snapshot.voiceAudio.observedAt).not.toBe('client-clock');expect(snapshot.interactionState).toBe('RESPONDING');
   const raw=await fetch(`${base}/voice/events`,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({...command,event:{type:'audio.state',state:{...state,pcm:[1,2,3]}}})});expect(raw.status).toBeGreaterThanOrEqual(400);
   const events=await k.eventStore.readFrom('0',1000);expect(events.some(e=>JSON.stringify(e.payload).includes('client-clock'))).toBe(false);
  }finally{await k.stop();}
 });
});
