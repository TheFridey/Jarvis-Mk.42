import type { VoiceEventCommand, VoiceEventResponse, VoicePerceptionEvent } from '@jarvis/contracts';
import { injectTraceHeaders, withSpan } from '@jarvis/telemetry';
import type { VoiceKernel } from './contracts.ts';
export class HttpVoiceKernel implements VoiceKernel {
 private sessionId?:string;
 private auth?:{accessToken:string;sessionId:string};
 private authenticating?:Promise<{accessToken:string;sessionId:string}>;
 constructor(private o:{url:string;bootstrapCredential:string;principalId:string;nodeId:string;fetcher?:typeof fetch}){}
 private async authenticate(){
  if(this.auth)return this.auth;
  if(!this.authenticating)this.authenticating=(async()=>{
   const res=await(this.o.fetcher??fetch)(`${this.o.url.replace(/\/$/,'')}/auth/session`,{method:'POST',signal:AbortSignal.timeout(5000),headers:injectTraceHeaders({'content-type':'application/json'}),body:JSON.stringify({credential:this.o.bootstrapCredential,nodeId:this.o.nodeId,scopes:['voice.write'],surface:'voice'})});
   if(!res.ok)throw new Error(`Kernel session exchange ${res.status}`);
   const body=await res.json() as {accessToken:string;credential:{sessionId:string}};
   return this.auth={accessToken:body.accessToken,sessionId:body.credential.sessionId};
  })().finally(()=>{this.authenticating=undefined;});
  return this.authenticating;
 }
 async send(event:VoicePerceptionEvent):Promise<VoiceEventResponse>{
  const commandId=crypto.randomUUID();
  const deliver=async()=>{
   const auth=await this.authenticate();
   const withSession=this.sessionId&&event.type!=='activation'?{...event,sessionId:this.sessionId}:event;
   const res=await(this.o.fetcher??fetch)(`${this.o.url.replace(/\/$/,'')}/voice/events`,{method:'POST',signal:AbortSignal.timeout(event.type==='asr.final'?30000:5000),headers:injectTraceHeaders({authorization:`Bearer ${auth.accessToken}`,'x-jarvis-node-id':this.o.nodeId,'x-jarvis-session-id':auth.sessionId,'content-type':'application/json'}),body:JSON.stringify({commandId,principalId:this.o.principalId,nodeId:this.o.nodeId,event:withSession} satisfies VoiceEventCommand)});
   if(!res.ok){if(res.status===401)this.auth=undefined;throw new Error(`Kernel voice HTTP ${res.status}`);}
   const body=await res.json() as VoiceEventResponse;
   if(!['runtime.health','audio.state'].includes(event.type))this.sessionId=event.type==='deactivate'?undefined:body.sessionId;
   return body;
  };
  return event.type==='asr.final'||event.type==='activation'?withSpan('user.interaction',{'jarvis.correlation_id':commandId,'jarvis.causation_id':commandId,'jarvis.node_id':this.o.nodeId},deliver):deliver();
 }
 get activeSessionId(){return this.sessionId;}
}
