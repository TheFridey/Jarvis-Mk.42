import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import { randomUUID } from 'node:crypto';
import type { VoiceGateway } from '../voice/voice-gateway.ts';
import type { connectRtcAgent } from './rtc-agent.ts';

export interface RtcBinding {principalId:string;nodeId:string;sessionId:string;accessToken:string}
export class RtcService {
  private client:RoomServiceClient;private rooms=new Map<string,{binding:RtcBinding;room:string;voiceSession:string;agent:Awaited<ReturnType<typeof connectRtcAgent>>;identity:string;expiresAt:number}>();
  private sweeping=false;private timer:ReturnType<typeof setInterval>;private speechFailed=false;
  private joining=new Set<string>();
  constructor(private d:{url:string;apiKey:string;apiSecret:string;voice:VoiceGateway;validate:(binding:RtcBinding)=>Promise<boolean>;invalidate:()=>void}) {
    this.client=new RoomServiceClient(d.url.replace(/^ws/,'http'),d.apiKey,d.apiSecret);this.timer=setInterval(()=>void this.sweep(),2000);this.timer.unref();
  }
  async health(){try{await this.client.listRooms();return {status:process.platform==='win32'&&!this.speechFailed?'HEALTHY' as const:'DEGRADED' as const,placeholder:false};}catch{return{status:'OFFLINE' as const,placeholder:false};}}
  private async token(room:string,identity:string,agent=false){const token=new AccessToken(this.d.apiKey,this.d.apiSecret,{identity,ttl:15});token.addGrant({roomJoin:true,room,canPublish:true,canSubscribe:agent,canPublishData:false,canPublishSources:[TrackSource.MICROPHONE]});if(!agent)token.addGrant({canSubscribe:true});return token.toJwt();}
  async join(binding:RtcBinding,speechMode:'local'|'cloud'='local'){
    if(!await this.d.validate(binding))throw new Error('RTC binding unavailable');
    if(this.joining.has(binding.sessionId))throw new Error('RTC join already pending');
    if(this.rooms.has(binding.sessionId))await this.leave(binding);
    if(this.rooms.size+this.joining.size>=4)throw new Error('RTC capacity reached');
    this.joining.add(binding.sessionId);
    const room='jarvis-'+randomUUID(),identity='surface-'+randomUUID();
    let voiceSession:string|undefined;
    try{
      const activated=await this.d.voice.handle({commandId:randomUUID(),principalId:binding.principalId,nodeId:binding.nodeId,event:{type:'activation',activation:'push-to-talk',deviceId:'webrtc-microphone'}});voiceSession=activated.sessionId;
      const {connectRtcAgent}=await import('./rtc-agent.ts');
      await this.client.createRoom({name:room,maxParticipants:2,emptyTimeout:15});
      const agent=await connectRtcAgent({url:this.d.url,token:await this.token(room,'agent-'+randomUUID(),true),identity,sessionId:activated.sessionId,principalId:binding.principalId,nodeId:binding.nodeId,voice:this.d.voice,speechMode,onFailure:(stage)=>{this.speechFailed=true;process.stderr.write(`[rtc] ${speechMode} ${stage??'unknown'} unavailable\n`);this.d.invalidate();}});
      if(!await this.d.validate(binding)){await agent.close();throw new Error('RTC binding revoked during join');}
      this.rooms.set(binding.sessionId,{binding,room,voiceSession:activated.sessionId,agent,identity,expiresAt:Date.now()+20*60000});this.d.invalidate();
      return{url:this.d.url,token:await this.token(room,identity),room,sessionId:activated.sessionId};
    }catch(error){await this.client.deleteRoom(room).catch(()=>undefined);if(voiceSession)await this.endVoice(binding,voiceSession);throw error;}finally{this.joining.delete(binding.sessionId);}
  }
  private async endVoice(binding:RtcBinding,sessionId:string){await this.d.voice.handle({commandId:randomUUID(),principalId:binding.principalId,nodeId:binding.nodeId,event:{type:'deactivate',sessionId}}).catch(()=>undefined);}
  async leave(binding:RtcBinding){const active=this.rooms.get(binding.sessionId);if(!active)return;if(active.binding.principalId!==binding.principalId||active.binding.nodeId!==binding.nodeId)throw new Error('RTC owner mismatch');this.rooms.delete(binding.sessionId);await this.client.deleteRoom(active.room).catch(()=>undefined);try{await active.agent.close();}finally{await this.endVoice(binding,active.voiceSession);this.d.invalidate();}}
  private async sweep(){if(this.sweeping)return;this.sweeping=true;try{for(const active of this.rooms.values()){if(Date.now()>active.expiresAt||!await this.d.validate(active.binding))await this.leave(active.binding);}}catch{for(const active of [...this.rooms.values()])await this.leave(active.binding).catch(()=>undefined);}finally{this.sweeping=false;}}
  async close(){clearInterval(this.timer);for(const active of [...this.rooms.values()])await this.leave(active.binding);}
}
