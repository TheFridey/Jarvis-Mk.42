import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { fork,spawn,spawnSync,type ChildProcess,type Serializable } from 'node:child_process';
import { mkdtempSync,readFileSync,rmSync,mkdirSync,writeFileSync } from 'node:fs';
import { WebSocket } from 'ws';
import { request } from 'node:https';
import { tmpdir } from 'node:os';
import { resolve,join } from 'node:path';
import { setupIt,type ItContext } from './it-harness.ts';
import { SystemClock } from '../src/runtime/clock.ts';
import { NodeClient,type NodeClientConfig } from '../src/kernel/nodes/node-client.ts';
import type { KernelHandle } from '../src/kernel/lifecycle/kernel.ts';

type Message={type:string;frame?:Record<string,unknown>;epoch?:number;pid?:number;trustTier?:string};
class Runtime {
  process:ChildProcess;messages:Message[]=[];
  constructor(profileFile?:string){
    this.process=profileFile?spawn(process.execPath,['--import','tsx',resolve('apps/core/src/node-cli.ts')],{env:{...process.env,JARVIS_NODE_PROFILE_FILE:profileFile},stdio:['ignore','pipe','pipe'],windowsHide:true}):fork(resolve('apps/core/src/node-cli.ts'),[],{execArgv:['--import','tsx'],stdio:['ignore','ignore','pipe','ipc']});
    this.process.on('message',m=>this.messages.push(m as Message));let output='';this.process.stdout?.on('data',chunk=>{output+=String(chunk);const lines=output.split('\n');output=lines.pop()??'';for(const line of lines){if(line)this.messages.push(JSON.parse(line) as Message);}});
  }
  send(value:Serializable){this.process.send?.(value);}
  async wait(predicate:(m:Message)=>boolean,timeout=15000){const deadline=Date.now()+timeout;while(Date.now()<deadline){const i=this.messages.findIndex(predicate);if(i>=0)return this.messages.splice(i,1)[0]!;if(this.process.exitCode!==null)throw new Error('node runtime exited');await new Promise(r=>setTimeout(r,20));}throw new Error('runtime evidence timed out: '+JSON.stringify(this.messages));}
  frame(type:string){return this.wait(m=>m.type==='frame'&&m.frame?.type===type);}
  async stop(){if(this.process.exitCode!==null)return;if(this.process.connected)this.send({type:'exit'});else this.process.kill();await new Promise<void>(resolve=>{const timer=setTimeout(()=>{this.process.kill();resolve();},3000);this.process.once('exit',()=>{clearTimeout(timer);resolve();});});}
}
async function eventually(check:()=>Promise<boolean>,timeout=8000){const deadline=Date.now()+timeout;while(Date.now()<deadline){if(await check())return;await new Promise(r=>setTimeout(r,30));}throw new Error('live evidence timed out');}

describe('Node Protocol v1 actual private network',()=>{
 let ctx:ItContext,k:KernelHandle,directory:string;const runtimes:Runtime[]=[],clients:NodeClient[]=[];
 const names=['workstation-1','workstation-1-rotated','display-1','token-replay','token-expired','forged-id','trust-attack','heartbeat-attack','session-attack','scope-attack','sequence-attack','unadmitted-attack','idle-node','receipt-attack','expired-credential','restart-node','unattached-node','auto-node','mobile-node','rotation-attack','rotation-attack-rotated'];
 const pem=(name:string)=>readFileSync(join(directory,name),'utf8');
 function config(nodeId:string,keyName=nodeId):NodeClientConfig{return{endpoint:`https://127.0.0.1:${k.nodeIngressPort}`,ca:pem('ca.crt'),cert:pem(keyName+'.crt'),key:pem(keyName+'.key'),descriptor:{nodeId,nodeType:nodeId==='display-1'?'display':'workstation',protocolVersion:'1',sensors:['runtime-health'],capabilities:['windows.repair'],surfaces:['status-display','camera-raw'],requestedTrustTier:nodeId==='display-1'?'guest':'owned-secure',attributes:{}}};}
 function client(nodeId:string,keyName=nodeId){const c=new NodeClient(config(nodeId,keyName));clients.push(c);return c;}
 async function attached(nodeId:string,trust:'guest'|'owned-secure'|'owned-mobile'='owned-secure'){
   const c=client(nodeId);c.config.descriptor.requestedTrustTier=trust;
   expect((await c.enroll(await k.nodes.createEnrollment(k.config.bootstrapPrincipalId,trust))).code).toBe(201);await c.authenticate(0);
   const admission=new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('admission timed out')),10000);c.on('frame',f=>{if(f.type==='ADMIT'){clearTimeout(timer);resolve();}else if(f.type==='REJECTED'){clearTimeout(timer);reject(new Error(JSON.stringify(f)));}});});await c.connect();await admission;return c;
 }
 beforeAll(async()=>{
   directory=mkdtempSync(join(tmpdir(),'jarvis-node-proof-'));
   const provision=spawnSync(process.execPath,['scripts/node-pki.mjs',directory,...names],{encoding:'utf8',windowsHide:true});if(provision.status!==0)throw new Error('private PKI provisioning failed');
   ctx=await setupIt();k=ctx.makeKernel({clock:new SystemClock(),noHttp:false,nodeIngressTls:{ca:pem('ca.crt'),cert:pem('server.crt'),key:pem('server.key'),heartbeatMs:1000}});await k.start();
 });
 afterAll(async()=>{for(const c of clients)c.terminate();for(const r of runtimes)await r.stop();await ctx?.cleanup();if(directory&&resolve(directory).startsWith(resolve(tmpdir())+requireSeparator())&&directory.includes('jarvis-node-proof-'))rmSync(directory,{recursive:true,force:true});});

 it('proves workstation + display runtimes, certificate identity, RTT, subscription, durable event identity, reconnect, rotation and revocation',async()=>{
   const workstation=new Runtime();runtimes.push(workstation);
   const token=await k.nodes.createEnrollment(k.config.bootstrapPrincipalId,'owned-secure');workstation.send({type:'start',config:config('workstation-1'),token});
   const enrolled=await workstation.wait(m=>m.type==='enrolled');expect(enrolled.trustTier).toBe('owned-secure');
   const started=await workstation.wait(m=>m.type==='started');expect(started.pid).not.toBe(process.pid);expect(started.epoch).toBe(1);
   const admitted=await workstation.frame('ADMIT');expect(admitted.frame?.admission).toMatchObject({grantedCapabilities:[],grantedSubscriptions:['system-status'],grantedTrustTier:'owned-secure'});
   const heartbeat=await workstation.frame('HEARTBEAT_ACK');expect(heartbeat.frame?.rttMs).toBeGreaterThanOrEqual(0);
   workstation.send({type:'send',frame:{type:'SUBSCRIBE',channel:'system-status'}});const state=await workstation.frame('STATE');expect(state.frame?.projection).toMatchObject({protocolVersion:'1',node:{nodeId:'workstation-1',state:'connected'}});expect(JSON.stringify(state)).not.toMatch(/transcript|approvals|accessToken|principalId|rawAudio/);
   workstation.send({type:'send',frame:{type:'OPERATE',operationId:'distributed-proof',observation:{sensor:'runtime-health',healthy:true}}});const operation=await workstation.frame('OPERATED');expect(operation.frame?.duplicate).toBe(false);
   const events=await k.eventStore.byCorrelation('distributed-proof');expect(events).toHaveLength(1);expect(events[0]).toMatchObject({source:{node:'workstation-1',component:'node-ingress'},actor:{kind:'node',id:'workstation-1'},provenance:{producedOn:'workstation-1',derivedFromUntrusted:true}});
   workstation.send({type:'terminate'});await workstation.wait(m=>m.type==='disconnected');await eventually(async()=>!(await ctx.pg.sql<{connected:boolean}[]>`select connected from nodes.connections where node_id='workstation-1'`)[0]?.connected);
   expect((await client('workstation-1').http('/nodes/authenticate',{nodeId:'workstation-1',expectedEpoch:0})).code).toBe(403);
   workstation.send({type:'start',config:config('workstation-1'),epoch:1});expect((await workstation.wait(m=>m.type==='started')).epoch).toBe(2);await workstation.frame('ADMIT');
   workstation.send({type:'send',frame:{type:'OPERATE',operationId:'distributed-proof',observation:{sensor:'runtime-health',healthy:true}}});const replay=await workstation.frame('OPERATED');expect(replay.frame).toMatchObject({eventId:operation.frame?.eventId,duplicate:true});expect(await k.eventStore.byCorrelation('distributed-proof')).toHaveLength(1);
   workstation.send({type:'rotate',certificatePem:pem('workstation-1-rotated.crt'),privateKey:pem('workstation-1-rotated.key')});await workstation.frame('ROTATED');await workstation.wait(m=>m.type==='disconnected');
   expect((await client('workstation-1').http('/nodes/authenticate',{nodeId:'workstation-1',expectedEpoch:2})).code).toBe(403);
   workstation.send({type:'start',config:config('workstation-1','workstation-1-rotated'),epoch:2});expect((await workstation.wait(m=>m.type==='started')).epoch).toBe(3);await workstation.frame('ADMIT');
   const display=new Runtime();runtimes.push(display);display.send({type:'start',config:config('display-1'),token:await k.nodes.createEnrollment(k.config.bootstrapPrincipalId,'guest')});const displayStarted=await display.wait(m=>m.type==='started');expect(displayStarted.pid).not.toBe(started.pid);await display.frame('ADMIT');
   display.send({type:'send',frame:{type:'SUBSCRIBE',channel:'system-status'}});expect((await display.frame('STATE')).frame?.projection).toMatchObject({node:{nodeId:'display-1'}});
   display.send({type:'send',frame:{type:'DISCONNECT'}});await display.frame('DISCONNECTED');await display.wait(m=>m.type==='disconnected');
   await k.nodes.revoke('workstation-1');await workstation.wait(m=>m.type==='disconnected');expect((await client('workstation-1','workstation-1-rotated').http('/nodes/authenticate',{nodeId:'workstation-1',expectedEpoch:3})).code).toBe(403);
   mkdirSync('artifacts/node-protocol',{recursive:true});writeFileSync('artifacts/node-protocol/latest.json',JSON.stringify({measuredAt:new Date().toISOString(),transport:'mTLS WebSocket TLS1.3',bind:'127.0.0.1',serverPid:process.pid,workstationPid:started.pid,displayPid:displayStarted.pid,heartbeatRttMs:heartbeat.frame?.rttMs,reconnectEpoch:2,rotationEpoch:3,operationEventId:operation.frame?.eventId,operationCount:1,sourceNode:events[0]?.source.node,revocation:'rejected',physicalHosts:1},null,2)+'\n');
 });

 it('rejects replayed/expired enrollment and forged certificate identity, honours the ceiling',async()=>{
   const replay=client('token-replay'),token=await k.nodes.createEnrollment(k.config.bootstrapPrincipalId,'guest');expect((await replay.enroll(token)).body.trustTier).toBe('guest');
   expect((await client('token-expired').enroll(token)).code).toBe(403);
   const expired=await k.nodes.createEnrollment(k.config.bootstrapPrincipalId,'guest',1);await new Promise(r=>setTimeout(r,10));expect((await client('token-expired').enroll(expired)).code).toBe(403);
   const forged=client('forged-id');expect((await forged.http('/nodes/enroll',{token:await k.nodes.createEnrollment(k.config.bootstrapPrincipalId,'guest'),descriptor:{...forged.config.descriptor,nodeId:'kernel-server'},softwareVersion:'1'})).code).toBe(403);
 });
 it.each([['trust-attack','trust'],['heartbeat-attack','heartbeat'],['session-attack','session'],['scope-attack','scope'],['sequence-attack','sequence'],['unadmitted-attack','sensor'],['forged-id','node'],['mobile-node','mobile']])('rejects %s at the live transport boundary',async(nodeId,attack)=>{
   const c=await attached(nodeId,attack==='scope'?'guest':attack==='mobile'?'owned-mobile':'owned-secure');
   const rejected=new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('rejection evidence timed out')),10000);c.on('frame',f=>{if(f.type==='REJECTED'){clearTimeout(timer);resolve();}});});
   if(attack==='trust')c.send({type:'DECLARE',descriptor:{...c.config.descriptor,requestedTrustTier:'kernel-local'}});
   else if(attack==='heartbeat')c.send({type:'HEARTBEAT',nonce:'fake'.repeat(12)});
   else if(attack==='session')c.send({type:'SUBSCRIBE',channel:'system-status'},{sessionId:'wrong-session'});
   else if(attack==='scope'||attack==='mobile')c.send({type:'OPERATE',operationId:'denied-op',observation:{sensor:'runtime-health',healthy:true}});
   else if(attack==='sequence')c.send({type:'SUBSCRIBE',channel:'system-status'},{sequence:1});
   else if(attack==='node')c.send({type:'SUBSCRIBE',channel:'system-status'},{nodeId:'local-server'});
   else c.send({type:'OPERATE',operationId:'sensor-op',observation:{sensor:'camera-raw',healthy:true}});
   await rejected;expect(await k.eventStore.byCorrelation('denied-op')).toHaveLength(0);
 });
 it('rejects stolen old credentials even with the right device certificate and fences old sessions',async()=>{
   const nodeId='idle-node',c=await attached(nodeId);
   const stolen=c.sessionBinding!;
   const [old]=await ctx.pg.sql<{secret_hash:string;session_id:string}[]>`select secret_hash,session_id from identity.access_credentials where node_id=${nodeId} and revoked_at is null`;
   const replacement=client(nodeId);await replacement.authenticate(1);await replacement.connect();
   await eventually(async()=>{const [r]=await ctx.pg.sql<{revoked_at:Date|null}[]>`select revoked_at from identity.access_credentials where secret_hash=${old!.secret_hash}`;return!!r?.revoked_at;});
   c.terminate();
   expect(await k.credentials.authenticate('Bearer '+stolen.accessToken,{nodeId,sessionId:old!.session_id,scopes:['nodes.read']})).toBeNull();
   const cfg=config(nodeId),oldSocket=new WebSocket(cfg.endpoint.replace('https:','wss:')+'/nodes/socket',{ca:cfg.ca,cert:cfg.cert,key:cfg.key,headers:{authorization:'Bearer '+stolen.accessToken,'x-jarvis-session-id':stolen.sessionId,'x-jarvis-node-epoch':String(stolen.epoch)}});
   await new Promise<void>((resolve,reject)=>{oldSocket.once('open',()=>{oldSocket.terminate();reject(new Error('stolen credential accepted'));});oldSocket.once('error',()=>resolve());});
   replacement.autoHeartbeat=false;await eventually(async()=>{const [n]=await ctx.pg.sql<{status:string}[]>`select status from nodes.registry where node_id=${nodeId}`;return n?.status==='disconnected';});
   await eventually(async()=>k.health.report().subsystems.find(s=>s.subsystem===`node:${nodeId}`)?.status==='OFFLINE');
 });
 it('requires a device certificate at the TLS boundary',async()=>{
   await new Promise<void>((resolve,reject)=>{const req=request(config('display-1').endpoint+'/nodes/status',{ca:pem('ca.crt'),agent:false},res=>{res.resume();reject(new Error('certificate-free connection accepted'));});req.on('error',()=>resolve());req.end();});
 });
 it('rejects expiry of a previously valid access credential',async()=>{
   const c=await attached('expired-credential'),binding=c.sessionBinding!;
   const disconnected=new Promise<void>(resolve=>c.once('disconnected',resolve));
   await ctx.pg.sql`update identity.access_credentials set expires_at=now()-interval '1 second' where node_id='expired-credential'`;
   await disconnected;expect(await k.credentials.authenticate('Bearer '+binding.accessToken,{nodeId:binding.nodeId,sessionId:binding.sessionId,scopes:['nodes.read']})).toBeNull();
 });
 it('rejects a duplicate operation ID with changed content and creates no second event',async()=>{
   const c=await attached('receipt-attack');
   const first=new Promise<void>(resolve=>c.on('frame',f=>{if(f.type==='OPERATED')resolve();}));
   c.send({type:'OPERATE',operationId:'receipt-conflict',observation:{sensor:'runtime-health',healthy:true}});await first;
   const rejected=new Promise<void>(resolve=>c.on('frame',f=>{if(f.type==='REJECTED')resolve();}));
   c.send({type:'OPERATE',operationId:'receipt-conflict',observation:{sensor:'runtime-health',healthy:false}});await rejected;expect(await k.eventStore.byCorrelation('receipt-conflict')).toHaveLength(1);
 });
 it('times out an authenticated node that never attaches a socket',async()=>{
   const c=client('unattached-node');expect((await c.enroll(await k.nodes.createEnrollment(k.config.bootstrapPrincipalId,'owned-secure'))).code).toBe(201);await c.authenticate(0);
   await eventually(async()=>{const [row]=await ctx.pg.sql<{connected:boolean}[]>`select connected from nodes.connections where node_id='unattached-node'`;return row?.connected===false;});
   expect(await k.credentials.authenticate('Bearer '+c.sessionBinding!.accessToken,{nodeId:'unattached-node',sessionId:c.sessionBinding!.sessionId,scopes:['nodes.read']})).toBeNull();
 });
 it('preserves operation deduplication when the network server restarts',async()=>{
   const c=await attached('restart-node');
   const first=new Promise<Record<string,unknown>>(resolve=>c.on('frame',f=>{if(f.type==='OPERATED')resolve(f);}));
   c.send({type:'OPERATE',operationId:'restart-operation',observation:{sensor:'runtime-health',healthy:true}});const original=await first;
   const port=k.nodeIngressPort!;await k.nodeIngress.close();await k.nodeIngress.listen({port,ca:pem('ca.crt'),cert:pem('server.crt'),key:pem('server.key'),heartbeatMs:1000});
   const replacement=client('restart-node');await replacement.authenticate(1);
   const admitted=new Promise<void>(resolve=>replacement.on('frame',f=>{if(f.type==='ADMIT')resolve();}));await replacement.connect();await admitted;
   const replay=new Promise<Record<string,unknown>>(resolve=>replacement.on('frame',f=>{if(f.type==='OPERATED')resolve(f);}));
   replacement.send({type:'OPERATE',operationId:'restart-operation',observation:{sensor:'runtime-health',healthy:true}});expect(await replay).toMatchObject({duplicate:true,eventId:original.eventId});expect(await k.eventStore.byCorrelation('restart-operation')).toHaveLength(1);
 });
 it('uses the normal runtime profile, subscribes automatically and reconnects after server loss',async()=>{
   const cfg=config('auto-node'),tokenFile=join(directory,'auto-node.token'),profileFile=join(directory,'auto-node.profile.json');
   const operator=await fetch(`http://127.0.0.1:${k.diagnosticsPort}/auth/session`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({credential:k.config.bootstrapCredential,nodeId:k.config.nodeId,scopes:['nodes.manage']})});expect(operator.status).toBe(201);
   const auth=await operator.json() as {accessToken:string;credential:{sessionId:string}};
   const headers={'content-type':'application/json',authorization:'Bearer '+auth.accessToken,'x-jarvis-node-id':k.config.nodeId,'x-jarvis-session-id':auth.credential.sessionId};
   const issued=await fetch(`http://127.0.0.1:${k.diagnosticsPort}/nodes/enrollments`,{method:'POST',headers,body:JSON.stringify({trustCeiling:'owned-secure'})});expect(issued.status).toBe(201);const grant=await issued.json() as {token:string};writeFileSync(tokenFile,grant.token,{mode:0o600});
   writeFileSync(profileFile,JSON.stringify({endpoint:cfg.endpoint,descriptor:cfg.descriptor,caFile:join(directory,'ca.crt'),certFile:join(directory,'auto-node.crt'),keyFile:join(directory,'auto-node.key'),tokenFile}),{mode:0o600});
   const runtime=new Runtime(profileFile);runtimes.push(runtime);expect((await runtime.wait(m=>m.type==='started')).epoch).toBe(1);await runtime.frame('STATE');
   const port=k.nodeIngressPort!;await k.nodeIngress.close();await k.nodeIngress.listen({port,ca:pem('ca.crt'),cert:pem('server.crt'),key:pem('server.key'),heartbeatMs:1000});
   expect((await runtime.wait(m=>m.type==='reconnected')).epoch).toBeGreaterThan(1);await runtime.frame('STATE');
   const revoked=await fetch(`http://127.0.0.1:${k.diagnosticsPort}/nodes/revoke`,{method:'POST',headers,body:JSON.stringify({nodeId:'auto-node'})});expect(revoked.status).toBe(200);await runtime.wait(m=>m.type==='reconnect-blocked');
 });
 it('rejects rotation without possession of the replacement private key',async()=>{
   const c=await attached('rotation-attack');
   const [original]=await ctx.pg.sql<{public_key_fingerprint:string}[]>`select public_key_fingerprint from nodes.registry where node_id='rotation-attack'`;
   const rejected=new Promise<void>(resolve=>c.on('frame',f=>{if(f.type==='REJECTED')resolve();}));
   c.rotate(pem('rotation-attack-rotated.crt'),pem('rotation-attack.key'));await rejected;
   const [after]=await ctx.pg.sql<{public_key_fingerprint:string}[]>`select public_key_fingerprint from nodes.registry where node_id='rotation-attack'`;expect(after?.public_key_fingerprint).toBe(original?.public_key_fingerprint);
 });
});
function requireSeparator(){return process.platform==='win32'?'\\':'/';}
