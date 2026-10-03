import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { ExperienceChannel, ExperienceClientMessage, ExperienceServerMessage, ExperienceStreamUpdate } from '@jarvis/scene';
import { ALL_EXPERIENCE_CHANNELS, ExperienceProjection, filterExperienceUpdate } from './experience-projection.ts';
import type { NotificationRecord } from '@jarvis/contracts';

interface AuthBinding { accessToken:string; nodeId:string; sessionId:string; }
interface Client { ws:WebSocket; binding:AuthBinding; channels:ExperienceChannel[]; alive:boolean; delivery:Promise<void>; pending:number; }
export class ExperienceStreamServer {
  private readonly wss:WebSocketServer; private readonly clients=new Set<Client>(); private heartbeat?:ReturnType<typeof setInterval>; private offProjection?:()=>void;
  constructor(private readonly deps:{projection:ExperienceProjection;authenticate:(binding:AuthBinding,scopes:string[])=>Promise<unknown>;allowedOrigin:(origin:string)=>boolean;heartbeatMs?:number;maxBufferedBytes?:number;authTimeoutMs?:number;reportError?:(error:unknown)=>void;surfaceConnected?:()=>void}){this.wss=new WebSocketServer({noServer:true,maxPayload:32_768})}
  attach(server:Server){server.on('upgrade',this.onUpgrade);this.offProjection=this.deps.projection.subscribe((update)=>this.broadcast(update));this.heartbeat=setInterval(()=>void this.checkClients(),this.deps.heartbeatMs??10_000)}
  disconnectSession(sessionId:string){for(const client of this.clients)if(client.binding.sessionId===sessionId)client.ws.close(4003,'session revoked')}
  activeBindings(){return [...this.clients].filter(c=>c.ws.readyState===WebSocket.OPEN&&c.alive).map(c=>({...c.binding}));}
  async deliverNotification(record:NotificationRecord){for(const client of this.clients)if(client.binding.nodeId===record.deliverySurfaceId){const auth=await this.deps.authenticate(client.binding,['experience.read']);if(auth&&typeof auth==='object'&&'principalId' in auth&&auth.principalId===record.request.principalId)this.send(client,{type:'experience.notification',schemaVersion:1,id:record.id,title:record.request.title,body:record.request.body,severity:record.request.severity});}}
  async close(){if(this.heartbeat)clearInterval(this.heartbeat);this.heartbeat=undefined;this.offProjection?.();this.offProjection=undefined;for(const client of this.clients)client.ws.close(1001,'server shutdown');this.clients.clear();this.wss.close()}
  private readonly onUpgrade=(request:IncomingMessage,socket:import('node:stream').Duplex,head:Buffer)=>{const url=new URL(request.url??'/',`http://${request.headers.host??'localhost'}`);if(url.pathname!=='/experience/stream')return;const origin=request.headers.origin;if(origin&&!this.deps.allowedOrigin(origin)){socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');socket.destroy();return}this.wss.handleUpgrade(request,socket,head,(ws)=>this.accept(ws))}
  private accept(ws:WebSocket){let authenticated=false;const timer=setTimeout(()=>ws.close(4001,'authentication timeout'),this.deps.authTimeoutMs??5_000);ws.once('message',(data)=>void(async()=>{try{const message=this.parse(data.toString());if(message.type!=='experience.subscribe')throw new Error('subscription required');const channels=this.validateChannels(message.channels);const binding={accessToken:message.accessToken,nodeId:message.nodeId,sessionId:message.sessionId};if(!await this.deps.authenticate(binding,['experience.read']))throw new Error('unauthorised');authenticated=true;clearTimeout(timer);const client:Client={ws,binding,channels,alive:true,delivery:Promise.resolve(),pending:0};this.clients.add(client);this.deps.surfaceConnected?.();ws.on('pong',()=>{client.alive=true});ws.on('close',()=>this.clients.delete(client));this.send(client,{type:'experience.ready',schemaVersion:1,streamId:this.deps.projection.streamId,sequence:this.deps.projection.currentSequence,heartbeatMs:this.deps.heartbeatMs??10_000});const resumed=message.resume?this.deps.projection.updatesAfter(message.resume.streamId,message.resume.sequence):undefined;if(message.resume&&resumed){for(const update of resumed)this.sendUpdate(client,update)}else{if(message.resume)this.send(client,{type:'experience.resync_required',schemaVersion:1,streamId:this.deps.projection.streamId,reason:'resume position unavailable'});this.sendUpdate(client,await this.deps.projection.fullUpdate(channels))}}catch(error){this.sendRaw(ws,{type:'experience.error',schemaVersion:1,code:'unauthorised',detail:error instanceof Error?error.message:String(error)});ws.close(4003,'unauthorised')}})());ws.on('error',(error)=>{if(authenticated)this.deps.reportError?.(error)})}
  private async checkClients(){for(const client of [...this.clients]){if(!client.alive){client.ws.terminate();this.clients.delete(client);continue}client.alive=false;try{if(!await this.deps.authenticate(client.binding,['experience.read'])){client.ws.close(4003,'credential revoked');continue}this.send(client,{type:'experience.heartbeat',schemaVersion:1,at:new Date().toISOString(),sequence:this.deps.projection.currentSequence});client.ws.ping()}catch(error){this.deps.reportError?.(error);client.ws.close(1011,'heartbeat failed')}}}
  private broadcast(update:ExperienceStreamUpdate){for(const client of this.clients)this.sendUpdate(client,update)}
  private sendUpdate(client:Client,update:ExperienceStreamUpdate){
    const filtered=filterExperienceUpdate(update,client.channels);if(!filtered)return;
    if(++client.pending>128){client.ws.close(1013,'projection queue full');return;}
    client.delivery=client.delivery.then(async()=>{
      if(client.ws.readyState!==WebSocket.OPEN)return;
      const auth=await this.deps.authenticate(client.binding,['experience.read']);
      if(!auth){client.ws.close(4003,'credential revoked');return;}
      const picture=await this.deps.projection.snapshot();
      if(typeof auth==='object'&&'principalId' in auth&&picture.principalId!==auth.principalId){client.ws.close(4003,'principal changed');return;}
      this.send(client,filtered);
    }).catch(error=>{this.deps.reportError?.(error);client.ws.close(1011,'projection delivery failed');}).finally(()=>{client.pending--;});
  }
  private send(client:Client,message:ExperienceServerMessage){if(client.ws.readyState!==WebSocket.OPEN)return;if(client.ws.bufferedAmount>(this.deps.maxBufferedBytes??1_000_000)){client.ws.close(1013,'backpressure');return}client.ws.send(JSON.stringify(message))}
  private sendRaw(ws:WebSocket,message:ExperienceServerMessage){if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(message))}
  private parse(raw:string):ExperienceClientMessage{const value=JSON.parse(raw) as ExperienceClientMessage;if(!value||value.schemaVersion!==1||typeof value.type!=='string')throw new Error('invalid stream message');return value}
  private validateChannels(channels:ExperienceChannel[]){if(!Array.isArray(channels)||!channels.length||channels.some((channel)=>!ALL_EXPERIENCE_CHANNELS.includes(channel)))throw new Error('invalid channels');return[...new Set(channels)]}
}
