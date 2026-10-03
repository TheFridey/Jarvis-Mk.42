import {afterAll,beforeAll,describe,it,expect,vi} from 'vitest';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {setupIt,type ItContext} from './it-harness.ts';
import type {KernelHandle} from '../src/kernel/lifecycle/kernel.ts';
import {NodeClient} from '../src/kernel/nodes/node-client.ts';
import {companionDescriptor,type CognitionResponse,type ModelResponse} from '@jarvis/contracts';
import {SystemClock} from '../src/runtime/clock.ts';

describe('companion continuity over actual mTLS and PostgreSQL',()=>{
  let ctx:ItContext,k:KernelHandle,dir:string;const clients:NodeClient[]=[];
  let releaseMobile:(()=>void)|undefined,modelCalls=0;
  const frames=new Map<NodeClient,Record<string,unknown>[]>();
  const pem=(name:string)=>readFileSync(join(dir,name),'utf8');
  async function next(client:NodeClient,type:string,predicate:(f:Record<string,unknown>)=>boolean=()=>true){
    let found:Record<string,unknown>|undefined;await vi.waitFor(()=>{const list=frames.get(client)!;const index=list.findIndex(f=>f.type===type&&predicate(f));if(index<0)throw new Error('Missing '+type+'; observed '+JSON.stringify(list.map(f=>({type:f.type,reason:f.reason,error:f.error}))));found=list.splice(index,1)[0];},{timeout:15000,interval:25});return found!;
  }
  async function connect(id:string,surface:'mobile'|'wall'){
    const client=new NodeClient({endpoint:`https://127.0.0.1:${k.nodeIngressPort}`,ca:pem('ca.crt'),cert:pem(id+'.crt'),key:pem(id+'.key'),descriptor:companionDescriptor(id,surface)});
    clients.push(client);frames.set(client,[]);client.on('frame',f=>frames.get(client)!.push(f));
    expect((await client.enroll(await k.nodes.createEnrollment(k.config.bootstrapPrincipalId,'owned-mobile'))).code).toBe(201);
    await client.authenticate(0);await client.connect();await next(client,'ADMIT');await next(client,'HEARTBEAT_ACK');client.send({type:'SUBSCRIBE',channel:'companion'});await next(client,'COMPANION_STATE');return client;
  }
  beforeAll(async()=>{
    dir=mkdtempSync(join(tmpdir(),'jarvis-companion-'));
    const provision=spawnSync(process.execPath,['scripts/node-pki.mjs',dir,'mobile-one','wall-one','wall-attack','mobile-upgrade'],{encoding:'utf8',windowsHide:true});if(provision.status!==0)throw new Error('private PKI provisioning failed');
    ctx=await setupIt();k=ctx.makeKernel({noHttp:false,clock:new SystemClock(),modelGateway:{async generate(req){
      modelCalls++;if(req.input.instruction.includes('Continue that discussion'))await new Promise<void>(resolve=>{releaseMobile=resolve;});
      const now=new Date().toISOString();const provenance={method:'model' as const,producedBy:'fixture-local',producedOn:'test',producedAt:now,correlationId:req.correlationId,derivedFromUntrusted:true};
      return {modelId:'fixture-local',output:{proposals:[{proposalId:'fixture-answer',kind:'answer',correlationId:req.correlationId,confidence:1,provenance,text:'Continued answer',citations:[]}]},usage:{contextUnits:1,outputUnits:1,costEstimate:0,latencyMs:1},finishReason:'stop',provenance} satisfies ModelResponse;
    }},nodeIngressTls:{ca:pem('ca.crt'),cert:pem('server.crt'),key:pem('server.key'),heartbeatMs:1000}});await k.start();await k.experience.snapshot();
  });
  afterAll(async()=>{releaseMobile?.();for(const c of clients)c.terminate();await ctx?.cleanup();if(dir&&resolve(dir).startsWith(resolve(tmpdir())+sep)&&dir.includes('jarvis-companion-'))rmSync(dir,{recursive:true,force:true});});
  it('continues a desktop thread on mobile, displays agent/status changes on wall, and presents a live Scene reference',async()=>{
    const mobile=await connect('mobile-one','mobile'),wall=await connect('wall-one','wall');
    const inference=vi.spyOn(k.cognition,'submit');
    const exchange=await fetch(`http://127.0.0.1:${k.diagnosticsPort}/auth/session`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({nodeId:k.config.nodeId,credential:k.config.bootstrapCredential,scopes:['desktop.read','desktop.write']})});expect(exchange.status).toBe(201);
    const auth=await exchange.json() as {accessToken:string;credential:{sessionId:string}};const headers={'content-type':'application/json',authorization:'Bearer '+auth.accessToken,'x-jarvis-node-id':k.config.nodeId,'x-jarvis-session-id':auth.credential.sessionId};
    const response=await fetch(`http://127.0.0.1:${k.diagnosticsPort}/desktop/cognition`,{method:'POST',headers,body:JSON.stringify({commandId:'desktop-turn',expectedStateVersion:(await k.state.view()).stateVersion,input:'Discuss the deployment'})});expect(response.status).toBe(200);
    const desktop=await response.json() as CognitionResponse;expect(desktop.conversationId).toBeTruthy();
    mobile.send({type:'CONVERSE',commandId:'continue-turn',conversationId:desktop.conversationId,input:'Continue that discussion',expectedStateVersion:(await k.state.view()).stateVersion});
    await vi.waitFor(()=>expect(releaseMobile).toBeDefined(),{timeout:15000});
    const running=await next(wall,'COMPANION_STATE',f=>(f.picture as {agents:Array<{id:string;state:string}>}|undefined)?.agents.some(a=>a.id==='agents.oracle'&&a.state==='WAITING')??false);
    expect(running.picture).toMatchObject({agents:[{id:'agents.oracle',state:'WAITING'}]});
    await next(mobile,'HEARTBEAT_ACK');releaseMobile!();
    const reply=await next(mobile,'COMMAND_RESULT');if(reply.ok!==true){const request=inference.mock.calls.at(-1)?.[0];const evidence=request?await k.eventStore.byCorrelation(request.correlationId):[];throw new Error('Fixture mobile command failed: '+JSON.stringify(evidence.filter(e=>e.type.includes('.rejected')).map(e=>e.payload)));}expect(reply.ok).toBe(true);
    expect(inference.mock.calls.at(-1)?.[0]).toMatchObject({analysisOnly:true,agentId:'agents.oracle',locality:'local',cloudAllowed:false});expect(inference.mock.calls.at(-1)?.[0].input).toContain('Discuss the deployment');
    const picture=await next(mobile,'COMPANION_STATE',f=>JSON.stringify(f).includes('Continue that discussion'));expect(JSON.stringify(picture)).toContain(desktop.conversationId);
    const history=await fetch(`http://127.0.0.1:${k.diagnosticsPort}/desktop/conversations`,{headers});expect((await history.json()) as unknown[]).toHaveLength(2);
    const count=modelCalls;mobile.send({type:'CONVERSE',commandId:'continue-turn',conversationId:desktop.conversationId,input:'Continue that discussion',expectedStateVersion:0});expect((await next(mobile,'COMMAND_RESULT')).ok).toBe(true);expect(modelCalls).toBe(count);
    mobile.send({type:'PRESENT',displayNodeId:'wall-one',objectId:'core',expectedSceneVersion:(await k.state.view()).stateVersion});expect((await next(mobile,'COMMAND_RESULT')).ok).toBe(true);
    const displayed=await next(wall,'COMPANION_STATE',f=>JSON.stringify(f).includes('"presented"'));expect(displayed.picture).toMatchObject({surface:'wall',presented:{objectId:'core',title:'JARVIS'}});expect(JSON.stringify(displayed)).not.toContain('Continue that discussion');
    const [selection]=await ctx.pg.sql<{object_id:string}[]>`select object_id from experience.wall_presentations where node_id='wall-one'`;expect(selection?.object_id).toBe('core');
    await k.notifications.submit({source:'test',principalId:k.config.bootstrapPrincipalId,severity:'critical',urgency:'immediate',title:'Kernel urgent alert',body:'Urgent details',dedupeKey:'companion-alert',correlationId:'companion-alert'});
    expect((await next(mobile,'NOTIFICATION')).notification).toMatchObject({title:'Kernel urgent alert'});
    inference.mockRestore();
  });
  it('keeps mobile below workstation trust and rejects wall commands and mobile capability observations',async()=>{
    const profile=companionDescriptor('mobile-upgrade','mobile');profile.requestedTrustTier='owned-secure';
    const upgrade=new NodeClient({endpoint:`https://127.0.0.1:${k.nodeIngressPort}`,ca:pem('ca.crt'),cert:pem('mobile-upgrade.crt'),key:pem('mobile-upgrade.key'),descriptor:profile});clients.push(upgrade);
    expect((await upgrade.enroll(await k.nodes.createEnrollment(k.config.bootstrapPrincipalId,'owned-secure'))).body.trustTier).toBe('owned-mobile');
    upgrade.config.descriptor.requestedTrustTier='owned-mobile';
    frames.set(upgrade,[]);upgrade.on('frame',f=>frames.get(upgrade)!.push(f));await upgrade.authenticate(0);await upgrade.connect();await next(upgrade,'ADMIT');upgrade.send({type:'OPERATE',operationId:'mobile-observation',observation:{sensor:'runtime-health',healthy:true}});await next(upgrade,'REJECTED');
    const wall=await connect('wall-attack','wall');wall.send({type:'CONVERSE',commandId:'wall-command',input:'Execute',expectedStateVersion:0});await next(wall,'REJECTED');
    const mobile=clients.find(c=>c.config.descriptor.nodeId==='mobile-one')!;
    mobile.send({type:'REVOKE_SELF'});await next(mobile,'REVOKED');expect((await mobile.http('/nodes/status')).code).toBe(403);
    expect((await ctx.pg.sql<{status:string}[]>`select status from nodes.registry where node_id='mobile-one'`)[0]?.status).toBe('revoked');
  });
});
