import { createServer, type Server } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { TLSSocket } from 'node:tls';
import { createHash, randomBytes, X509Certificate, verify } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { WebSocket, WebSocketServer } from 'ws';
import { EventNames, companionScopes, type NodeAdmission, type RegisteredNode } from '@jarvis/contracts';
import type { CompanionService } from '../experience/companion-service.ts';
import type { DeliverySurface } from '../notification/surface-routing.ts';
import type { NotificationRecord } from '@jarvis/contracts';
import type { Sql } from '@jarvis/persistence';
import type { NodeManager } from './node-manager.ts';
import type { NodeStore } from './node-store.ts';
import type { SessionCredentialManager, AccessCredentialStore } from '../identity/access-credentials.ts';
import type { SessionManager } from '../session/session-manager.ts';
import type { EventManager, TxRunner } from '../event-fabric/event-manager.ts';
import type { Clock } from '../../runtime/clock.ts';
import { KeyedMutex } from '../../runtime/mutex.ts';
import { authenticationSchema, enrollmentSchema, frameSchema, type NodeStatusProjection } from './node-wire.ts';

export interface NodeIngressTls { ca:string;cert:string;key:string;port?:number;host?:'127.0.0.1'|'::1';heartbeatMs?:number; }
interface Binding { node:RegisteredNode;sessionId:string;epoch:number;token:string; }
interface Peer extends Binding { socket:WebSocket;sequence:number;admission?:NodeAdmission;subscribed:boolean;companion:boolean;commandPending:boolean;snapshotPending:boolean;nonce:string;sentAt:number;lastBeat:number;pending:number;tickPending:boolean; }
export interface NodeIngressDeps {
  surfaceConnected?:()=>void;
  companion?:CompanionService;
  sql:Sql;tx:TxRunner;nodes:NodeManager;store:NodeStore;credentials:SessionCredentialManager;accessStore:AccessCredentialStore;
  sessions:SessionManager;events:EventManager;clock:Clock;id:()=>string;
  status:()=>Promise<{mode:string;overallHealth:string}>;
  health:(nodeId:string,online:boolean)=>Promise<void>;
  reportError:()=>void;
}
const fingerprint=(certificate:X509Certificate)=>'sha256:'+createHash('sha256').update(certificate.publicKey.export({type:'spki',format:'der'})).digest('hex');
const tierRank={guest:0,'owned-mobile':1,'owned-secure':2,'kernel-local':3};

/** Private mTLS only. CA signing is an offline operator responsibility; the
 * Kernel never holds the CA private key. Enrollment binds a preissued device
 * certificate to an operator-issued, single-use trust-ceiling token. */
export class NodeIngress {
  setCompanion(service:CompanionService){this.d.companion=service;}
  onSurfaceConnected(callback:()=>void){this.d.surfaceConnected=callback;}
  async deliverySurfaces():Promise<DeliverySurface[]>{const surfaces:DeliverySurface[]=[];for(const peer of this.peers.values())if(peer.companion&&peer.subscribed){try{await this.live(peer,['companion.read']);surfaces.push({id:peer.node.nodeId,principalId:peer.node.principalId,kind:peer.node.nodeType==='mobile'?'mobile':'wall',trust:peer.node.trustTier,available:peer.socket.readyState===WebSocket.OPEN,presence:'UNKNOWN'});}catch{/* revoked nodes are never eligible */}}return surfaces;}
  deliverNotification(record:NotificationRecord):void{const peer=record.deliverySurfaceId?this.peers.get(record.deliverySurfaceId):undefined;if(!peer||peer.node.principalId!==record.request.principalId)return;void this.gate.run(peer.node.nodeId,async()=>{await this.live(peer,['companion.read']);this.send(peer,{type:'NOTIFICATION',notification:{id:record.id,title:peer.node.nodeType==='display'?'Important JARVIS alert':record.request.title,body:peer.node.nodeType==='display'?'Review on your trusted personal surface':record.request.body,severity:record.request.severity}});}).catch(()=>this.d.reportError());}
  private server?:Server;
  private wss?:WebSocketServer;
  private timer?:ReturnType<typeof setInterval>;
  private peers=new Map<string,Peer>();
  private gate=new KeyedMutex();
  private ca?:X509Certificate;
  private heartbeatMs=5000;
  private stopping=false;
  private maintenancePending=false;
  private maintenance?:Promise<void>;
  constructor(private d:NodeIngressDeps){}

  async listen(tls:NodeIngressTls):Promise<number>{
    const host=tls.host??'127.0.0.1';
    if(host!=='127.0.0.1'&&host!=='::1')throw new Error('node ingress is loopback-only');
    if(this.server?.listening)throw new Error('node ingress already listening');
    this.heartbeatMs=tls.heartbeatMs??5000;
    if(this.heartbeatMs<100||this.heartbeatMs>30000)throw new Error('invalid heartbeat interval');
    this.ca=new X509Certificate(tls.ca);this.stopping=false;
    // A new server instance cannot inherit a previous socket's authority.
    const abandoned=await this.d.sql<{node_id:string;session_id:string|null}[]>`update nodes.connections set connected=false,epoch=epoch+1 where connected=true returning node_id,session_id`;
    for(const old of abandoned){
      if(old.session_id){await this.d.accessStore.revokeSession(old.session_id,this.d.clock.nowIso());await this.d.sessions.transition({sessionId:old.session_id,to:'ended',reason:'node ingress restarted',expectedVersion:-1});}
      await this.d.sql`update nodes.registry set status='disconnected',version=version+1 where node_id=${old.node_id} and status not in ('revoked','isolated')`;
    }
    this.wss=new WebSocketServer({noServer:true,maxPayload:32768,perMessageDeflate:false});
    this.server=createServer({ca:tls.ca,cert:tls.cert,key:tls.key,requestCert:true,rejectUnauthorized:true,minVersion:'TLSv1.3'},(req,res)=>{void this.http(req,res);});
    this.server.requestTimeout=10000;this.server.headersTimeout=10000;
    this.server.on('upgrade',(req,socket,head)=>{
      void (async()=>{
        if(req.url!=='/nodes/socket'||req.headers.origin)throw new Error('invalid upgrade');
        if(this.stopping)throw new Error('node ingress draining');
        const nodeId=this.certificateNode(req);
        await this.gate.run(nodeId,async()=>{
          if(this.stopping)throw new Error('node ingress draining');
          const binding=await this.binding(req,nodeId);
          if(this.peers.has(nodeId)||this.peers.size>=256)throw new Error('node already attached');
          this.wss!.handleUpgrade(req,socket,head,ws=>this.attach(ws,binding));
        });
      })().catch(()=>{socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');});
    });
    const port=await new Promise<number>((resolve,reject)=>{
      this.server!.once('error',reject);this.server!.listen(tls.port??0,host,()=>{const a=this.server!.address();if(!a||typeof a==='string')return reject(new Error('no ingress address'));resolve(a.port);});
    });
    this.timer=setInterval(()=>{for(const peer of this.peers.values()){
      if(peer.tickPending)continue;peer.tickPending=true;
      void this.gate.run(peer.node.nodeId,()=>this.tick(peer)).catch(()=>this.fail(peer)).finally(()=>{peer.tickPending=false;});
    }
      if(!this.maintenancePending){this.maintenancePending=true;this.maintenance=this.reapUnattached().catch(()=>this.d.reportError()).finally(()=>{this.maintenancePending=false;});}
    },this.heartbeatMs);
    this.timer.unref();return port;
  }

  private certificateNode(req:IncomingMessage):string{
    const socket=req.socket;
    if(!(socket instanceof TLSSocket)||!socket.authorized)throw new Error('mTLS required');
    const cert=socket.getPeerX509Certificate();
    if(!cert||!cert.subjectAltName?.match(/^URI:urn:jarvis:node:[A-Za-z0-9._:-]{3,128}$/))throw new Error('invalid certificate identity');
    return cert.subjectAltName.slice('URI:urn:jarvis:node:'.length);
  }
  private peerFingerprint(req:IncomingMessage){const cert=(req.socket as TLSSocket).getPeerX509Certificate();if(!cert)throw new Error('certificate required');return fingerprint(cert);}
  private async required(req:IncomingMessage,nodeId:string){const n=await this.d.store.get(nodeId);if(!n||['revoked','isolated'].includes(n.status)||n.publicKeyFingerprint!==this.peerFingerprint(req))throw new Error('invalid node');return n;}
  private async body(req:IncomingMessage):Promise<unknown>{let size=0;const chunks:Buffer[]=[];for await(const chunk of req){const b=Buffer.from(chunk);size+=b.length;if(size>32768)throw new Error('oversized body');chunks.push(b);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  private async http(req:IncomingMessage,res:ServerResponse){
    const send=(code:number,value:unknown)=>{res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
    try{
      if(this.stopping)return send(503,{error:'node ingress draining'});
      const nodeId=this.certificateNode(req);
      if(req.method==='GET'&&req.url==='/nodes/status'){
        await this.required(req,nodeId);const rows=await this.d.sql<{epoch:string}[]>`select epoch from nodes.connections where node_id=${nodeId}`;return send(200,{nodeId,epoch:Number(rows[0]?.epoch??0)});
      }
      if(req.method!=='POST')return send(404,{error:'not found'});
      const body=await this.body(req);
      await this.gate.run(nodeId,async()=>{
        if(this.stopping)return send(503,{error:'node ingress draining'});
        if(req.url==='/nodes/enroll'){
          const input=enrollmentSchema.parse(body);if(input.descriptor.nodeId!==nodeId)throw new Error('certificate node mismatch');
          // Declarations are NOT authority. No capability or sensor is admitted yet.
          const node=await this.d.nodes.enroll({...input,descriptor:{...input.descriptor,capabilities:[],sensors:[],surfaces:[]},publicKeyFingerprint:this.peerFingerprint(req)});
          await this.d.sql`insert into nodes.connections(node_id) values(${nodeId})`;
          return send(201,{nodeId:node.nodeId,trustTier:node.trustTier,epoch:0});
        }
        if(req.url==='/nodes/authenticate'){
          const input=authenticationSchema.parse(body);if(input.nodeId!==nodeId)throw new Error('certificate node mismatch');
          const node=await this.required(req,nodeId);
          const rows=await this.d.sql<{epoch:string;session_id:string|null}[]>`select epoch,session_id from nodes.connections where node_id=${nodeId}`;
          if(!rows[0]||Number(rows[0].epoch)!==input.expectedEpoch)throw new Error('stale epoch');
          await this.d.accessStore.revokeNode(nodeId,this.d.clock.nowIso());
          if(rows[0].session_id)await this.d.sessions.transition({sessionId:rows[0].session_id,to:'ended',expectedVersion:-1,reason:'node reconnect'});
          this.peers.get(nodeId)?.socket.terminate();this.peers.delete(nodeId);
          let session=await this.d.sessions.open({type:'device',nodeId,principalId:node.principalId,correlationId:this.d.id()});
          const active=await this.d.sessions.transition({sessionId:session.id,to:'active',reason:'mTLS node authentication',expectedVersion:session.version});if(!active.ok)throw new Error('session unavailable');session=active.session;
          const epoch=input.expectedEpoch+1;
          const updated=await this.d.sql<{epoch:string}[]>`update nodes.connections set epoch=${epoch},session_id=${session.id},connected=true,attached_at=${this.d.clock.nowIso()} where node_id=${nodeId} and epoch=${input.expectedEpoch} and exists(select 1 from nodes.registry where node_id=${nodeId} and public_key_fingerprint=${node.publicKeyFingerprint} and status not in ('revoked','isolated')) returning epoch`;
          if(!updated.length)throw new Error('connection fenced');
          const issued=await this.d.credentials.issue({identityId:node.identityId,principalId:node.principalId,nodeId,sessionId:session.id,scopes:['nodes.declare','nodes.read',...companionScopes(node),...(node.trustTier==='owned-secure'&&node.nodeType!=='display'&&node.nodeType!=='mobile'?['nodes.observe']:[])],authStrength:'strong',generation:epoch});
          return send(201,{nodeId,epoch,sessionId:session.id,...issued});
        }
        send(404,{error:'not found'});
      });
    }catch{send(403,{error:'node request rejected'});}
  }
  private async binding(req:IncomingMessage,nodeId:string):Promise<Binding>{
    const node=await this.required(req,nodeId);
    const token=req.headers.authorization?.startsWith('Bearer ')?req.headers.authorization.slice(7):'';
    const sessionId=String(req.headers['x-jarvis-session-id']??'');const epoch=Number(req.headers['x-jarvis-node-epoch']);
    const binding={node,token,sessionId,epoch};await this.live(binding,['nodes.declare']);return binding;
  }
  private async live(b:Binding,scopes:string[]){
    const auth=await this.d.credentials.authenticate('Bearer '+b.token,{nodeId:b.node.nodeId,sessionId:b.sessionId,scopes,minimumStrength:'strong'});
    const current=await this.d.store.get(b.node.nodeId);
    const rows=await this.d.sql<{epoch:string;session_id:string;connected:boolean}[]>`select epoch,session_id,connected from nodes.connections where node_id=${b.node.nodeId}`;
    if(!auth||auth.identityId!==b.node.identityId||auth.principalId!==b.node.principalId||!current||current.publicKeyFingerprint!==b.node.publicKeyFingerprint||['revoked','isolated'].includes(current.status)||Number(rows[0]?.epoch)!==b.epoch||rows[0]?.session_id!==b.sessionId||!rows[0]?.connected)throw new Error('connection fenced');
  }
  private attach(socket:WebSocket,binding:Binding){
    const peer:Peer={...binding,socket,sequence:0,subscribed:false,companion:false,commandPending:false,snapshotPending:false,nonce:'',sentAt:0,lastBeat:performance.now(),pending:0,tickPending:false};this.peers.set(peer.node.nodeId,peer);
    socket.on('error',()=>this.fail(peer));
    socket.on('close',()=>{void this.gate.run(peer.node.nodeId,()=>this.disconnect(peer)).catch(()=>this.d.reportError());});
    socket.on('message',data=>{
      if(++peer.pending>32)return this.fail(peer);
      void this.gate.run(peer.node.nodeId,async()=>{
        try{await this.frame(peer,JSON.parse(data.toString()));}catch(error){
          const safeReasons=['node version conflict','connection fenced','sensor not admitted','invalid binding or sequence','heartbeat spoof','declaration required','trust escalation'];
          this.send(peer,{type:'REJECTED',error:'node frame rejected',reason:error instanceof Error&&safeReasons.includes(error.message)?error.message:'invalid frame'});this.fail(peer);
        }finally{peer.pending--;}
      }).catch(()=>this.fail(peer));
    });
    this.send(peer,{type:'AUTHENTICATED',epoch:peer.epoch,nodeId:peer.node.nodeId});this.challenge(peer);
  }
  private send(peer:Peer,value:unknown){if(peer.socket.readyState!==WebSocket.OPEN)return;if(peer.socket.bufferedAmount>65536)return this.fail(peer);peer.socket.send(JSON.stringify(value));}
  private challenge(peer:Peer){peer.nonce=randomBytes(32).toString('base64url');peer.sentAt=performance.now();this.send(peer,{type:'HEARTBEAT_CHALLENGE',nonce:peer.nonce,epoch:peer.epoch});}
  private async frame(peer:Peer,value:unknown){
    const f=frameSchema.parse(value);
    if(f.nodeId!==peer.node.nodeId||f.epoch!==peer.epoch||f.sessionId!==peer.sessionId||f.accessToken!==peer.token||f.sequence!==peer.sequence+1)throw new Error('invalid binding or sequence');
    const scope=f.type==='CONVERSE'?'companion.converse':f.type==='PRESENT'?'companion.present':f.type==='OPERATE'?'nodes.observe':f.type==='SUBSCRIBE'?(f.channel==='companion'?'companion.read':'nodes.read'):'nodes.declare';
    await this.live(peer,[scope]);peer.sequence=f.sequence;
    if(f.type==='DECLARE'){
      if(f.descriptor.nodeId!==peer.node.nodeId||f.descriptor.nodeType!==peer.node.nodeType||tierRank[f.descriptor.requestedTrustTier]>tierRank[peer.node.trustTier])throw new Error('trust escalation');
      const allowedSensors=peer.node.trustTier==='owned-secure'&&!['mobile','display'].includes(peer.node.nodeType)?['runtime-health']:[];
      peer.admission={nodeId:peer.node.nodeId,grantedTrustTier:peer.node.trustTier,grantedSubscriptions:['system-status',...(companionScopes(peer.node).includes('companion.read')?['companion']:[])],grantedCapabilities:[],heartbeatIntervalMs:this.heartbeatMs,admittedAt:this.d.clock.nowIso()};
      const current=await this.d.store.get(peer.node.nodeId);if(!current)throw new Error('missing node');
      await this.d.store.put({...current,sensors:f.descriptor.sensors.filter(s=>allowedSensors.includes(s)),capabilities:[],outputs:f.descriptor.surfaces.filter(s=>s==='status-display'||(s==='mobile-companion'&&peer.node.nodeType==='mobile')||(s==='wall-display'&&peer.node.nodeType==='display')),version:current.version+1});
      await this.d.events.emit({type:EventNames.NodeConnected,sourceNodeId:peer.node.nodeId,sourceComponent:'node-ingress',retentionClass:'OPERATIONAL',privacyClass:'INTERNAL',subject:{kind:'node',id:peer.node.nodeId},actor:{kind:'system',id:'node-ingress'},principalId:peer.node.principalId,correlationId:f.requestId,causationId:peer.sessionId,payload:{nodeId:peer.node.nodeId,nodeType:peer.node.nodeType,trustTier:peer.node.trustTier}});
      this.send(peer,{type:'ADMIT',requestId:f.requestId,admission:peer.admission});return;
    }
    if(!peer.admission)throw new Error('declaration required');
    if(f.type==='HEARTBEAT'){
      if(!peer.nonce||f.nonce!==peer.nonce)throw new Error('heartbeat spoof');
      const rttMs=Math.max(0,performance.now()-peer.sentAt);peer.nonce='';peer.lastBeat=performance.now();
      await this.d.nodes.heartbeat(peer.node.nodeId,peer.node.publicKeyFingerprint,{rttMs});await this.d.sessions.touch(peer.sessionId);await this.d.health(peer.node.nodeId,true);
      this.send(peer,{type:'HEARTBEAT_ACK',requestId:f.requestId,rttMs});return;
    }
    if(f.type==='SUBSCRIBE'){peer.subscribed=true;peer.companion=f.channel==='companion';this.startSnapshot(peer);if(peer.companion)this.d.surfaceConnected?.();return;}
    if(f.type==='REVOKE_SELF'){await this.d.nodes.revoke(peer.node.nodeId);this.send(peer,{type:'REVOKED',requestId:f.requestId});peer.socket.close(1000,'self revoked');return;}
    if(f.type==='CONVERSE'||f.type==='PRESENT'){
      if(!this.d.companion)throw new Error('companion unavailable');
      if(peer.commandPending){this.send(peer,{type:'COMMAND_RESULT',requestId:f.requestId,ok:false,error:'command busy'});return;}
      peer.commandPending=true;
      // Never hold the peer mutex while inference runs: heartbeat and emergency revoke remain available.
      const service=this.d.companion;
      void (async()=>{
        try{await this.live(peer,[scope]);let value:unknown;if(f.type==='CONVERSE'){const result=await service.converse(peer.node,{commandId:f.commandId,expectedStateVersion:f.expectedStateVersion,input:f.input},f.conversationId,true);value={turnId:result.turnId,conversationId:result.conversationId,answer:result.answer};}else value=await service.present(peer.node,f);await this.live(peer,[scope]);this.send(peer,{type:'COMMAND_RESULT',requestId:f.requestId,ok:true,value});}
        catch{this.send(peer,{type:'COMMAND_RESULT',requestId:f.requestId,ok:false,error:'command rejected; refresh current state'});}
        finally{peer.commandPending=false;}
      })();return;
    }
    if(f.type==='OPERATE'){
      const current=await this.d.store.get(peer.node.nodeId);if(!current?.sensors.includes(f.observation.sensor))throw new Error('sensor not admitted');
      const hash=createHash('sha256').update(JSON.stringify(f.observation)).digest('hex');
      const result=await this.d.tx.begin(async tx=>{
        const [node]=await tx<{status:string;public_key_fingerprint:string}[]>`select status,public_key_fingerprint from nodes.registry where node_id=${peer.node.nodeId} for update`;
        if(!node||['revoked','isolated'].includes(node.status)||node.public_key_fingerprint!==peer.node.publicKeyFingerprint)throw new Error('revoked');
        const [connection]=await tx<{epoch:string;connected:boolean}[]>`select epoch,connected from nodes.connections where node_id=${peer.node.nodeId} for update`;
        if(!connection?.connected||Number(connection.epoch)!==peer.epoch)throw new Error('stale connection');
        const [old]=await tx<{request_hash:string;event_id:string}[]>`select request_hash,event_id from nodes.operation_receipts where node_id=${peer.node.nodeId} and operation_id=${f.operationId}`;
        if(old){if(old.request_hash!==hash)throw new Error('operation conflict');return{eventId:old.event_id,duplicate:true};}
        const event=await this.d.events.emitInTx(tx,{type:EventNames.NodeRuntimeHealth,sourceNodeId:peer.node.nodeId,sourceComponent:'node-ingress',retentionClass:'OPERATIONAL',privacyClass:'INTERNAL',subject:{kind:'node',id:peer.node.nodeId},actor:{kind:'node',id:peer.node.nodeId},principalId:peer.node.principalId,correlationId:f.operationId,causationId:f.requestId,payload:f.observation,provenance:{method:'sensor',producedBy:peer.node.nodeId,producedOn:peer.node.nodeId,derivedFromUntrusted:true}},false);
        await tx`insert into nodes.operation_receipts(node_id,operation_id,request_hash,event_id,created_at) values(${peer.node.nodeId},${f.operationId},${hash},${event.id},${this.d.clock.nowIso()})`;
        return{eventId:event.id,duplicate:false};
      });
      this.send(peer,{type:'OPERATED',requestId:f.requestId,...result});return;
    }
    if(f.type==='ROTATE'){
      const cert=new X509Certificate(f.certificatePem);
      if(!this.ca||!cert.verify(this.ca.publicKey)||cert.ca||cert.subjectAltName!==`URI:urn:jarvis:node:${peer.node.nodeId}`||Date.parse(cert.validFrom)>this.d.clock.epochMs()||Date.parse(cert.validTo)<=this.d.clock.epochMs()||!cert.keyUsage?.includes('1.3.6.1.5.5.7.3.2'))throw new Error('invalid replacement certificate');
      const next=fingerprint(cert);if(next===peer.node.publicKeyFingerprint)throw new Error('new device key required');
      const challenge=`jarvis-node-rotate-v1|${f.nodeId}|${f.sessionId}|${f.epoch}|${f.sequence}|${createHash('sha256').update(cert.raw).digest('hex')}`;
      if(!verify('sha256',Buffer.from(challenge),cert.publicKey,Buffer.from(f.proof,'base64')))throw new Error('replacement key possession required');
      await this.d.nodes.rotateKey(peer.node.nodeId,peer.node.publicKeyFingerprint,next,0);await this.d.accessStore.revokeNode(peer.node.nodeId,this.d.clock.nowIso());
      this.send(peer,{type:'ROTATED',requestId:f.requestId,epoch:peer.epoch});peer.socket.close(1000,'key rotated');return;
    }
    this.send(peer,{type:'DISCONNECTED',requestId:f.requestId});peer.socket.close(1000,'disconnect');
  }
  private startSnapshot(peer:Peer){if(peer.snapshotPending)return;peer.snapshotPending=true;void this.snapshot(peer).catch(()=>this.fail(peer)).finally(()=>{peer.snapshotPending=false;});}
  private async snapshot(peer:Peer){
    if(peer.companion){if(!this.d.companion)throw new Error('companion unavailable');await this.live(peer,['companion.read']);const picture=await this.d.companion.picture(peer.node);await this.live(peer,['companion.read']);this.send(peer,{type:'COMPANION_STATE',epoch:peer.epoch,picture});return;}
    await this.live(peer,['nodes.read']);const status=await this.d.status();const n=await this.d.store.get(peer.node.nodeId);
    const projection:NodeStatusProjection={protocolVersion:'1',...status,node:{nodeId:peer.node.nodeId,state:n?.status??'disconnected',rttMs:typeof n?.health.rttMs==='number'?n.health.rttMs:null}};
    this.send(peer,{type:'STATE',epoch:peer.epoch,projection});
  }
  private async tick(peer:Peer){
    await this.live(peer,['nodes.declare']);
    if(performance.now()-peer.lastBeat>this.heartbeatMs*3)return this.fail(peer);
    // Keep a challenge outstanding until answered; never move its deadline.
    if(!peer.nonce)this.challenge(peer);
    if(peer.subscribed)this.startSnapshot(peer);
  }
  private async reapUnattached(){
    const cutoff=new Date(this.d.clock.epochMs()-this.heartbeatMs*3).toISOString();
    const rows=await this.d.sql<{node_id:string;epoch:string;session_id:string}[]>`select node_id,epoch,session_id from nodes.connections where connected=true and attached_at<${cutoff}`;
    for(const row of rows){if(this.peers.has(row.node_id))continue;await this.gate.run(row.node_id,async()=>{
      if(this.peers.has(row.node_id))return;
      const changed=await this.d.sql`update nodes.connections set connected=false where node_id=${row.node_id} and epoch=${row.epoch} and connected=true returning node_id`;if(!changed.length)return;
      await this.d.accessStore.revokeSession(row.session_id,this.d.clock.nowIso());await this.d.sessions.transition({sessionId:row.session_id,to:'ended',reason:'node attachment timed out',expectedVersion:-1});
      await this.d.sql`update nodes.registry set status='disconnected',version=version+1 where node_id=${row.node_id} and status not in ('revoked','isolated')`;
      if(!this.stopping)await this.d.health(row.node_id,false);
    });}
  }
  private fail(peer:Peer){
    if(peer.socket.readyState!==WebSocket.OPEN)return;
    peer.socket.close(1008,'node protocol violation');
    const deadline=setTimeout(()=>peer.socket.terminate(),1000);deadline.unref();
  }
  private async disconnect(peer:Peer){
    if(this.peers.get(peer.node.nodeId)===peer)this.peers.delete(peer.node.nodeId);
    const changed=await this.d.sql<{node_id:string}[]>`update nodes.connections set connected=false where node_id=${peer.node.nodeId} and epoch=${peer.epoch} and connected=true returning node_id`;
    if(!changed.length)return;
    await this.d.accessStore.revokeSession(peer.sessionId,this.d.clock.nowIso());
    await this.d.sessions.transition({sessionId:peer.sessionId,to:'ended',reason:'node disconnected',expectedVersion:-1});
    await this.d.sql`update nodes.registry set status='disconnected',version=version+1 where node_id=${peer.node.nodeId} and status not in ('revoked','isolated')`;
    await this.d.events.emit({type:EventNames.NodeDisconnected,sourceNodeId:peer.node.nodeId,sourceComponent:'node-ingress',retentionClass:'OPERATIONAL',privacyClass:'INTERNAL',subject:{kind:'node',id:peer.node.nodeId},actor:{kind:'system',id:'node-ingress'},principalId:peer.node.principalId,correlationId:this.d.id(),causationId:peer.sessionId,payload:{nodeId:peer.node.nodeId,reason:'transport disconnected'}});
    if(!this.stopping)await this.d.health(peer.node.nodeId,false);
  }
  async close(){this.stopping=true;if(this.timer)clearInterval(this.timer);await this.maintenance;for(const p of [...this.peers.values()]){p.socket.terminate();await this.gate.run(p.node.nodeId,()=>this.disconnect(p));}await new Promise<void>(resolve=>this.wss?this.wss.close(()=>resolve()):resolve());await new Promise<void>((resolve,reject)=>this.server?.listening?this.server.close(e=>e?reject(e):resolve()):resolve());}
}
