import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { companionDescriptor } from '@jarvis/contracts';
import { NodeClient } from '../../core/src/kernel/nodes/node-client.ts';

// Private profile: certificate paths and enrollment token never enter browser state.
const profilePath=process.env.JARVIS_DISPLAY_PROFILE_FILE;if(!profilePath)throw new Error('JARVIS_DISPLAY_PROFILE_FILE required');
const profile=JSON.parse(readFileSync(profilePath,'utf8')) as {nodeId:string;endpoint:string;caFile:string;certFile:string;keyFile:string;enrollmentToken?:string;port?:number};
const client=new NodeClient({endpoint:profile.endpoint,ca:readFileSync(profile.caFile,'utf8'),cert:readFileSync(profile.certFile,'utf8'),key:readFileSync(profile.keyFile,'utf8'),descriptor:companionDescriptor(profile.nodeId,'wall')});
let state:Record<string,unknown>={live:false};const html=readFileSync(fileURLToPath(new URL('../public/index.html',import.meta.url)));
const server=createServer((req,res)=>{
  const address=server.address();const port=typeof address==='object'&&address?address.port:0;
  if(req.headers.host!==`127.0.0.1:${port}`||req.method!=='GET'||(req.headers.origin&&req.headers.origin!==`http://127.0.0.1:${port}`)){res.writeHead(403);res.end();return;}
  res.setHeader('cache-control','no-store');res.setHeader('x-content-type-options','nosniff');res.setHeader('referrer-policy','no-referrer');
  if(req.url==='/state'){res.setHeader('content-type','application/json');res.end(JSON.stringify(state));return;}
  if(req.url!=='/'){res.writeHead(404);res.end();return;}
  res.setHeader('content-type','text/html');res.setHeader('content-security-policy',"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");res.end(html);
});
client.on('frame',(frame:Record<string,unknown>)=>{
  if(frame.type==='ADMIT')client.send({type:'SUBSCRIBE',channel:'companion'});
  if(frame.type==='COMPANION_STATE')state={live:true,picture:frame.picture,receivedAt:Date.now(),notification:state.notification};
  if(frame.type==='NOTIFICATION')state={...state,notification:frame.notification,notificationAt:Date.now()};
});
client.on('disconnected',()=>{state={live:false};});client.on('transport-error',()=>{state={live:false};});
if(profile.enrollmentToken){const result=await client.enroll(profile.enrollmentToken);if(result.code!==201)throw new Error('display enrollment rejected');}
const status=await client.http('/nodes/status');if(status.code!==200||typeof status.body.epoch!=='number')throw new Error('display unavailable');
await client.authenticate(status.body.epoch);await client.connect();
server.listen(profile.port??7423,'127.0.0.1',()=>{const a=server.address();if(typeof a==='object'&&a)process.stdout.write(`Wall display: http://127.0.0.1:${a.port}\n`);});
function stop(){client.terminate();server.close();}process.once('SIGINT',stop);process.once('SIGTERM',stop);
