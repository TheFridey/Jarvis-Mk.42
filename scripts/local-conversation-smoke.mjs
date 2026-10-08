// Local authenticated smoke; credentials are loaded from the ignored environment.
import {randomUUID} from 'node:crypto';
import {loadEnvFile} from 'node:process';
loadEnvFile('.env');
const base='http://127.0.0.1:7420';
const nodeId=process.env.JARVIS_NODE_ID??'local-server';
const auth=await fetch(base+'/auth/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({credential:process.env.JARVIS_BOOTSTRAP_CREDENTIAL??'dev-bootstrap-secret',nodeId,scopes:['desktop.read','desktop.write']})});
if(!auth.ok)throw new Error('Authentication failed: '+auth.status);
const session=await auth.json();
const headers={'content-type':'application/json',authorization:'Bearer '+session.accessToken,'x-jarvis-node-id':nodeId,'x-jarvis-session-id':session.credential.sessionId};
let conversationId;
for(const input of process.argv.length>2?process.argv.slice(2):['Hey Jarvis','What is a fun fact about the moon?']){
  const snapshot=await (await fetch(base+'/desktop/snapshot',{headers})).json();
  const response=await fetch(base+'/desktop/cognition',{method:'POST',headers,body:JSON.stringify({commandId:randomUUID(),expectedStateVersion:snapshot.stateVersion,input,...(conversationId?{conversationId}:{})})});
  const result=await response.json();
  console.log(JSON.stringify({input,status:response.status,answer:result.answer,error:result.error,requestId:result.requestId,proposals:result.result?.proposals?.map(p=>({kind:p.kind,invocation:p.invocation})),conversationId:result.conversationId}));
  conversationId=result.conversationId??result.value?.conversationId??result.result?.conversationId;
  if(!response.ok)break;
}
await fetch(base+'/auth/logout',{method:'POST',headers});
