import { readFileSync } from 'node:fs';
import { NodeClient, type NodeClientConfig } from './kernel/nodes/node-client.ts';
import type { NodeWireFrame } from './kernel/nodes/node-wire.ts';

// IPC is only a local process-control harness; all node interactions use mTLS.
let client:NodeClient|undefined;
let shuttingDown=false,reconnectTimer:ReturnType<typeof setTimeout>|undefined,reconnectAttempt=0;
function report(value:unknown){if(process.send)process.send(value);else process.stdout.write(JSON.stringify(value)+'\n');}
async function start(config:NodeClientConfig,token?:string,expectedEpoch=0){
  client=new NodeClient(config);
  client.on('frame',frame=>report({type:'frame',frame}));
  client.on('disconnected',()=>report({type:'disconnected'}));
  client.on('transport-error',()=>report({type:'transport-error'}));
  if(!process.send){
    client.on('disconnected',()=>scheduleReconnect());
    client.on('frame',frame=>{if(frame.type==='ADMIT'){reconnectAttempt=0;client?.send({type:'SUBSCRIBE',channel:'system-status'});}});
    const status=await client.http('/nodes/status');
    if(status.code===200&&typeof status.body.epoch==='number'){expectedEpoch=status.body.epoch;token=undefined;}
  }
  if(token){const enrolled=await client.enroll(token);if(enrolled.code!==201)throw new Error('enrollment rejected');report({type:'enrolled',nodeId:enrolled.body.nodeId,trustTier:enrolled.body.trustTier});}
  const epoch=await client.authenticate(expectedEpoch);await client.connect();report({type:'started',epoch,pid:process.pid});
}
function scheduleReconnect(){
  if(shuttingDown||reconnectTimer)return;
  const delay=Math.min(5000,250*2**Math.min(reconnectAttempt++,5));
  reconnectTimer=setTimeout(()=>{reconnectTimer=undefined;void (async()=>{
    if(shuttingDown||!client)return;
    const status=await client.http('/nodes/status');
    if(status.code>=500)throw new Error('node ingress temporarily unavailable');
    if(status.code!==200||typeof status.body.epoch!=='number'){report({type:'reconnect-blocked'});return;}
    await client.authenticate(status.body.epoch);await client.connect();report({type:'reconnected',epoch:client.sessionBinding?.epoch});
  })().catch(()=>scheduleReconnect());},delay);
}
if(process.send){
  process.on('message',(message:unknown)=>{void (async()=>{
    const m=message as {type:string;config:NodeClientConfig;token?:string;epoch?:number;certificatePem?:string;privateKey?:string;frame?:Omit<NodeWireFrame,'requestId'|'nodeId'|'sessionId'|'epoch'|'sequence'|'accessToken'> & Record<string,unknown>;overrides?:Record<string,unknown>};
    if(m.type==='start')await start(m.config,m.token,m.epoch);
    else if(m.type==='send'&&m.frame)client?.send(m.frame,m.overrides);
    else if(m.type==='rotate'&&m.certificatePem&&m.privateKey)client?.rotate(m.certificatePem,m.privateKey);
    else if(m.type==='heartbeat-off'&&client)client.autoHeartbeat=false;
    else if(m.type==='terminate')client?.terminate();
    else if(m.type==='exit'){client?.terminate();process.disconnect();}
  })().catch(()=>report({type:'error',error:'node runtime request rejected'}));});
}else{
  const path=process.env.JARVIS_NODE_PROFILE_FILE;if(!path)throw new Error('JARVIS_NODE_PROFILE_FILE required');
  const profile=JSON.parse(readFileSync(path,'utf8')) as {endpoint:string;caFile:string;certFile:string;keyFile:string;descriptor:NodeClientConfig['descriptor'];tokenFile?:string;epoch?:number};
  await start({endpoint:profile.endpoint,descriptor:profile.descriptor,ca:readFileSync(profile.caFile,'utf8'),cert:readFileSync(profile.certFile,'utf8'),key:readFileSync(profile.keyFile,'utf8')},profile.tokenFile?readFileSync(profile.tokenFile,'utf8').trim():undefined,profile.epoch??0);
  const stop=()=>{shuttingDown=true;if(reconnectTimer)clearTimeout(reconnectTimer);client?.terminate();process.exit(0);};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
