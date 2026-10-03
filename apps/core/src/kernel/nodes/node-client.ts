import { request } from 'node:https';
import { EventEmitter } from 'node:events';
import { randomUUID,sign,createHash,X509Certificate } from 'node:crypto';
import { WebSocket } from 'ws';
import type { NodeDescriptor } from '@jarvis/contracts';
import type { NodeWireFrame } from './node-wire.ts';

export interface NodeClientConfig {endpoint:string;ca:string;cert:string;key:string;descriptor:NodeDescriptor;}
interface Attachment {nodeId:string;epoch:number;sessionId:string;accessToken:string;}
export class NodeClient extends EventEmitter {
  private socket?:WebSocket;
  private sequence=0;
  private attachment?:Attachment;
  private nonce?:string;
  private admitted=false;
  private replacement?:{requestId:string;cert:string;key:string};
  autoHeartbeat=true;
  /** Local persistence boundary; callers must never log this credential. */
  get sessionBinding(){return this.attachment?{...this.attachment}:undefined;}
  constructor(readonly config:NodeClientConfig){super();const u=new URL(config.endpoint);if(u.protocol!=='https:'||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password||u.search||u.hash)throw new Error('private HTTPS endpoint required');}
  async http(path:string,body?:unknown):Promise<{code:number;body:Record<string,unknown>}>{
    const payload=body===undefined?undefined:JSON.stringify(body);
    return new Promise((resolve,reject)=>{
      const req=request(new URL(path,this.config.endpoint),{method:payload?'POST':'GET',ca:this.config.ca,cert:this.config.cert,key:this.config.key,agent:false,minVersion:'TLSv1.3',headers:payload?{'content-type':'application/json','content-length':Buffer.byteLength(payload)}:{}},res=>{
        let data='';res.on('data',chunk=>{data+=String(chunk);if(data.length>65536){req.destroy(new Error('response too large'));}});res.on('end',()=>{try{resolve({code:res.statusCode??0,body:JSON.parse(data)});}catch{reject(new Error('invalid response'));}});
      });req.setTimeout(10000,()=>req.destroy(new Error('node request timed out')));req.on('error',reject);req.end(payload);
    });
  }
  enroll(token:string){return this.http('/nodes/enroll',{token,descriptor:this.config.descriptor,softwareVersion:'node-runtime-v1'});}
  async authenticate(expectedEpoch:number){
    const response=await this.http('/nodes/authenticate',{nodeId:this.config.descriptor.nodeId,expectedEpoch});
    if(response.code!==201)throw new Error('node authentication rejected');
    const b=response.body;
    if(typeof b.sessionId!=='string'||typeof b.accessToken!=='string'||typeof b.epoch!=='number'||b.nodeId!==this.config.descriptor.nodeId)throw new Error('invalid authentication response');
    this.attachment={nodeId:b.nodeId,epoch:b.epoch,sessionId:b.sessionId,accessToken:b.accessToken};return b.epoch;
  }
  async connect(){
    if(!this.attachment)throw new Error('authenticate first');const b=this.attachment;this.sequence=0;this.admitted=false;this.nonce=undefined;
    const url=new URL('/nodes/socket',this.config.endpoint);url.protocol='wss:';
    const socket=new WebSocket(url,{ca:this.config.ca,cert:this.config.cert,key:this.config.key,minVersion:'TLSv1.3',maxPayload:65536,perMessageDeflate:false,headers:{authorization:'Bearer '+b.accessToken,'x-jarvis-session-id':b.sessionId,'x-jarvis-node-epoch':String(b.epoch)}});this.socket=socket;
    socket.on('message',data=>{
      const frame=JSON.parse(data.toString()) as Record<string,unknown>;
      const replacement=this.replacement;
      if(frame.type==='ROTATED'&&replacement&&frame.requestId===replacement.requestId){this.config.cert=replacement.cert;this.config.key=replacement.key;this.replacement=undefined;}
      this.emit('frame',frame);
      if(frame.type==='HEARTBEAT_CHALLENGE'&&typeof frame.nonce==='string'){this.nonce=frame.nonce;this.heartbeat();}
      if(frame.type==='ADMIT'){this.admitted=true;this.heartbeat();}
    });
    socket.on('close',()=>this.emit('disconnected'));socket.on('error',()=>this.emit('transport-error'));
    await new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('node connect timed out')),10000);socket.once('error',()=>{clearTimeout(timeout);reject(new Error('node socket rejected'));});socket.once('open',()=>{clearTimeout(timeout);resolve();});});
    this.send({type:'DECLARE',descriptor:this.config.descriptor});
  }
  private heartbeat(){if(this.autoHeartbeat&&this.admitted&&this.nonce){const nonce=this.nonce;this.nonce=undefined;this.send({type:'HEARTBEAT',nonce});}}
  send(input:Omit<NodeWireFrame,'requestId'|'nodeId'|'sessionId'|'epoch'|'sequence'|'accessToken'> & Record<string,unknown>,overrides:Record<string,unknown>={}){
    if(!this.socket||!this.attachment)throw new Error('not attached');
    const requestId=randomUUID();this.socket.send(JSON.stringify({...input,...this.attachment,sequence:++this.sequence,requestId,...overrides}));return requestId;
  }
  terminate(){this.socket?.terminate();}
  rotate(certificatePem:string,privateKey:string){
    const b=this.attachment;if(!b)throw new Error('not attached');
    const cert=new X509Certificate(certificatePem);
    const challenge=`jarvis-node-rotate-v1|${b.nodeId}|${b.sessionId}|${b.epoch}|${this.sequence+1}|${createHash('sha256').update(cert.raw).digest('hex')}`;
    const requestId=this.send({type:'ROTATE',certificatePem,proof:sign('sha256',Buffer.from(challenge),privateKey).toString('base64')});
    this.replacement={requestId,cert:certificatePem,key:privateKey};return requestId;
  }
}
