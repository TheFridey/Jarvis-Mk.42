import { afterAll, beforeAll, expect, it } from 'vitest';
import { setupIt, type ItContext } from './it-harness.ts';
import type { KernelHandle } from '../src/kernel/lifecycle/kernel.ts';
import type { CapabilityInvocationProposal, Grant } from '@jarvis/contracts';
import email from '../../../capabilities/email/definition.ts';
import calendar from '../../../capabilities/calendar/definition.ts';
import scalesmiths from '../../../capabilities/scalesmiths/definition.ts';
let ctx:ItContext;let kernel:KernelHandle;let sends=0;let scaleAvailable=false;
const principalId='principal-operator';
const google={principalId,clientId:'fixture',clientSecret:'fixture-secret',refreshToken:'fixture-refresh',calendars:['primary']};
const capabilities=Object.entries({email,calendar,scalesmiths}).map(([provider,definition])=>({manifest:definition.manifest,moduleUrl:new URL(`../../../capabilities/${provider}/definition.ts`,import.meta.url).href}));
const credentialMaterial={email:JSON.stringify(google),calendar:JSON.stringify(google),scalesmiths:JSON.stringify({principalId,baseUrl:'https://fixture.invalid/',token:'fixture-service-token',contractVersion:1,mutations:[]})};
const grant:Grant={id:'business-read',principalId,holder:{kind:'principal',id:principalId},scopes:capabilities.flatMap(c=>c.manifest.actions.filter(a=>!a.sideEffects.length).flatMap(a=>a.requiredScopes??[])),maxRiskWithoutLiveApproval:'LOW',mayProceedWithoutLiveApproval:true,issuedAt:'2026-09-01T00:00:00Z',version:1,resourceConstraints:[],nodeConstraints:[],timeWindows:[]};
const request:typeof fetch=async(url,init)=>{
  const path=String(url);
  if(path.includes('oauth2'))return Response.json({access_token:'fixture-access'});
  if(path.includes('fixture.invalid'))return scaleAvailable?Response.json({records:path.includes('clients.read')?[{id:'client1',entityType:'client',attributes:{name:'Fixture client'},sourceRef:'fixture:client1',observedAt:'2026-09-01T00:00:00Z',confidence:1,privacy:'RESTRICTED'}]:[],complete:true}):new Response('{}',{status:503});
  if(path.includes('/messages/send')){sends++;return Response.json({id:'sent1'});}
  if(path.includes('/messages/sent1'))return Response.json({id:'sent1',labelIds:['SENT'],payload:{mimeType:'text/plain',headers:[{name:'To',value:'fixture@example.com'},{name:'Subject',value:'Fixture message'}],body:{data:Buffer.from('Controlled test').toString('base64url')}}});
  if(path.includes('/threads/'))return Response.json({id:'thread1',messages:[{id:'message1',threadId:'thread1',snippet:'Fixture contact history',payload:{headers:[{name:'From',value:'fixture@example.com'}]}}]});
  if(path.includes('/messages?'))return Response.json({messages:[{id:'message1',threadId:'thread1'}]});
  if(path.includes('/events/'))return Response.json({id:'meeting1',summary:'Fixture meeting',start:{dateTime:'2026-09-01T09:00:00Z'},end:{dateTime:'2026-09-01T10:00:00Z'},attendees:[{email:'fixture@example.com'}]});
  if(path.includes('/events?'))return Response.json({items:[{id:'meeting1',summary:'Fixture meeting'}]});
  throw new Error(`Unexpected fixture request ${init?.method??'GET'}`);
};
beforeAll(async()=>{ctx=await setupIt();kernel=ctx.makeKernel({capabilities,credentialMaterial,bootstrapGrants:[grant],integrationRequest:request});await kernel.start();});
afterAll(async()=>{await ctx?.cleanup();});
const proposal=(id:string,action:string,input:unknown):CapabilityInvocationProposal=>({proposalId:id,kind:'capability_invocation',correlationId:`corr-${id}`,confidence:1,provenance:{method:'assertion',producedBy:principalId,producedOn:'local-server',producedAt:'2026-09-01T00:00:00Z',correlationId:`corr-${id}`,derivedFromUntrusted:false},invocation:{capabilityId:'capabilities.email',capabilityVersion:'2.0.0',action,input},justification:'Controlled integration fixture'});
it('reads Gmail through Executor and persists contact metadata only via ingestion',async()=>{
  const result=await kernel.agency.submit(proposal('gmail-read','thread.read',{threadId:'thread1'}),{principalId,authenticated:true});expect(result.outcome).toBe('verified');
  const [row]=await ctx.pg.sql`select e.type,f.privacy_class,f.epistemic_status,f.provenance,f.value from atlas.entities e join atlas.facts f on f.subject_entity_id=e.id where e.canonical_name='gmail:contact-history:message1'`;
  expect(row).toMatchObject({type:'contact',privacy_class:'RESTRICTED',epistemic_status:'retrieved'});expect(JSON.stringify(row)).not.toContain('fixture-refresh');
});
it('rejects cross-principal Gmail retrieval',async()=>{const result=await kernel.agency.submit(proposal('other-read','read',{messageId:'message1'}),{principalId:'other',authenticated:true});expect(result.outcome).toBe('denied');});
it('denies sends without the action scope and waits for a recorded approval once granted',async()=>{
  const input={to:['fixture@example.com'],subject:'Fixture message',body:'Controlled test'};
  expect((await kernel.agency.submit(proposal('send-denied','send',input),{principalId,authenticated:true})).outcome).toBe('denied');expect(sends).toBe(0);
  await kernel.permissions.modifyGrant(grant.id,{scopes:[...grant.scopes,'email.send']});
  const p=proposal('send-approved','send',input);const pending=await kernel.agency.submit(p,{principalId,authenticated:true});expect(pending.outcome).toBe('awaiting_approval');expect(sends).toBe(0);
  const approval=await kernel.approvals.forInvocation(pending.invocationId);expect(approval).toBeDefined();
  expect(await kernel.approvals.approve({invocationId:pending.invocationId,operatorId:principalId,sessionId:'fixture-session',authTrustLevel:'verified',nonce:approval!.nonce!,version:approval!.version!})).toBe(true);
  expect((await kernel.agency.submit(p,{principalId,authenticated:true})).outcome).toBe('verified');expect(sends).toBe(1);
  await kernel.agency.submitOnce(p,{principalId,authenticated:true});expect(sends).toBe(1);
});
it('checkpoints a partial meeting objective and resumes missing sources with a reconstructed kernel',async()=>{
  const partial=await kernel.business.createMeeting(principalId,{calendarId:'primary',eventId:'meeting1',clientId:'client1',contactEmail:'fixture@example.com'},'meeting-correlation');expect(partial.status).toBe('partial');
  expect((await kernel.objectives.get(partial.objectiveId))?.status).toBe('blocked');
  const [before]=await ctx.pg.sql`select count(*)::int as count from agency.invocations where capability_id='capabilities.calendar'`;
  await kernel.stop();scaleAvailable=true;
  kernel=ctx.makeKernel({capabilities,credentialMaterial,integrationRequest:request});await kernel.start();
  await expect(kernel.business.resumeMeeting('other',partial.objectiveId)).rejects.toThrow('principal mismatch');
  const completed=await kernel.business.resumeMeeting(principalId,partial.objectiveId);expect(completed.status).toBe('complete');expect(completed.sections['thread.read:thread1']).toBeDefined();
  const [after]=await ctx.pg.sql`select count(*)::int as count from agency.invocations where capability_id='capabilities.calendar'`;expect(after?.count).toBe(before?.count);
  expect((await kernel.objectives.get(partial.objectiveId))?.status).toBe('achieved');
  expect(await kernel.business.resumeMeeting(principalId,partial.objectiveId)).toEqual(completed);
},300000);
it('answers the morning situation from real verified Operating Picture fixtures without model calls',async()=>{
  const response=await kernel.cognition.submit({requestId:'morning1',principalId,correlationId:'morning-corr',input:'Jarvis, morning. Give me the situation.',agentId:'agents.nova',task:'reason'});
  expect(response.modelId).toBe('nova:operating-picture');expect(response.answer).toContain('MRR: available');expect(response.answer).toContain('invocation:');expect(response.answer).not.toContain('fixture-refresh');
  expect(response.answer).toContain('Kernel situation');expect(response.answer).toContain('"health"');expect(response.answer).toContain('"knowledge"');expect(response.answer).toContain('"notifications"');
  expect(kernel.business.picture('other').readings.MRR?.status).toBe('unavailable');
});
it('answers check production from measured local telemetry without inventing remote health or model activity',async()=>{
  const response=await kernel.cognition.submit({requestId:'production1',principalId,correlationId:'production-corr',input:'Jarvis, check production.',agentId:'agents.oracle',task:'reason'});
  expect(response.modelId).toBe('sentinel:measured-telemetry');expect(response.answer).toContain('not proof of a remote production deployment');expect(response.answer).toContain('"unknowns"');expect(response.result.proposals).toEqual([]);
});
