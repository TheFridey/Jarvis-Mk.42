import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { WebSocket } from 'ws';
import type { JarvisOperatingPicture } from '@jarvis/scene';
import { ExperienceProjection } from './experience-projection.ts';
import { ExperienceStreamServer } from './experience-stream.ts';
const picture=()=>({schemaVersion:2,operatingPictureVersion:1,generatedAt:new Date().toISOString(),stateVersion:1,sceneVersion:1,scene:{version:1}} as JarvisOperatingPicture);
const servers:Array<{http:Server;stream:ExperienceStreamServer}>=[];
afterEach(async()=>{for(const item of servers.splice(0)){await item.stream.close();await new Promise<void>((resolve)=>item.http.close(()=>resolve()))}});
async function setup(authenticate:ReturnType<typeof vi.fn<(binding:unknown,scopes:string[])=>Promise<unknown>>>=vi.fn(async()=>({principalId:'p'})),maxBufferedBytes=1_000_000,heartbeatMs=20){const projection=new ExperienceProjection({streamId:'stream',build:async()=>picture()});const http=createServer();const stream=new ExperienceStreamServer({projection,authenticate,allowedOrigin:()=>true,heartbeatMs,maxBufferedBytes,authTimeoutMs:50});stream.attach(http);await new Promise<void>((resolve)=>http.listen(0,'127.0.0.1',resolve));servers.push({http,stream});const address=http.address();return{projection,authenticate,url:`ws://127.0.0.1:${typeof address==='object'&&address?address.port:0}/experience/stream`}}
const subscribe=(ws:WebSocket)=>ws.send(JSON.stringify({type:'experience.subscribe',schemaVersion:1,accessToken:'token',nodeId:'node',sessionId:'session',channels:['system','scene']}));
const closed=(ws:WebSocket)=>new Promise<{code:number;reason:string}>((resolve)=>ws.once('close',(code,reason)=>resolve({code,reason:reason.toString()})));
describe('ExperienceStreamServer',()=>{
  it('authenticates a session-bound credential with the explicit experience scope',async()=>{const{url,authenticate}=await setup();const ws=new WebSocket(url);await new Promise<void>((resolve)=>ws.once('open',resolve));subscribe(ws);const message=await new Promise<string>((resolve)=>ws.once('message',(data)=>resolve(data.toString())));expect(JSON.parse(message).type).toBe('experience.ready');expect(authenticate).toHaveBeenCalledWith({accessToken:'token',nodeId:'node',sessionId:'session'},['experience.read']);ws.close()});
  it('rejects an unauthorised subscription before sending projection data',async()=>{const{url}=await setup(vi.fn(async()=>undefined));const ws=new WebSocket(url);await new Promise<void>((resolve)=>ws.once('open',resolve));const done=closed(ws);subscribe(ws);expect((await done).code).toBe(4003)});
  it('disconnects a revoked credential during heartbeat revalidation',async()=>{let valid=true;const{url}=await setup(vi.fn(async()=>valid));const ws=new WebSocket(url);await new Promise<void>((resolve)=>ws.once('open',resolve));subscribe(ws);await new Promise<void>((resolve)=>ws.once('message',()=>resolve()));valid=false;expect((await closed(ws)).code).toBe(4003)});
  it('disconnects a slow consumer instead of growing an unbounded queue',async()=>{const{url}=await setup(vi.fn(async()=>true),-1,1000);const ws=new WebSocket(url);await new Promise<void>((resolve)=>ws.once('open',resolve));const done=closed(ws);subscribe(ws);expect((await done).code).toBe(1013)});
});
