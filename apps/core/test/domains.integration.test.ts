import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isDockerAvailable } from '@jarvis/testkit';
import { setupIt, type ItContext } from './it-harness.ts';
import type { ModelRequest, ModelResponse, Provenance } from '@jarvis/contracts';
import { CompanionService } from '../src/kernel/experience/companion-service.ts';
import { AtlasStore } from '../src/kernel/atlas/stores.ts';
import { CredentialBroker } from '../src/kernel/credential-broker/broker.ts';
import { MemoryCredentialMaterialStore } from '../src/kernel/credential-broker/material-store.ts';
import { PgTokenCache } from '../src/kernel/permission/token-cache.ts';
import { PgInvocationStore } from '../src/kernel/executor/invocation-store.ts';
import { PgGrantStore } from '../src/kernel/permission/grant-store.ts';

const principalId='principal-operator';
const dockerOk=await isDockerAvailable();
const provenance=(correlationId:string):Provenance=>({method:'assertion',producedBy:principalId,producedOn:'local-server',producedAt:'2026-09-01T00:00:00.000Z',correlationId,derivedFromUntrusted:false});
describe.skipIf(!dockerOk)('Kernel domain ownership and context boundaries',()=>{
  let ctx:ItContext;
  let kernel:ReturnType<ItContext['makeKernel']>;
  const requests:ModelRequest[]=[];
  beforeAll(async()=>{
    ctx=await setupIt();
    kernel=ctx.makeKernel({noHttp:false,modelGateway:{async generate(req):Promise<ModelResponse>{requests.push(req);return {modelId:'domain-fixture-local',output:{proposals:[{proposalId:'answer-'+req.correlationId,kind:'answer',correlationId:req.correlationId,confidence:1,provenance:provenance(req.correlationId),text:'Domain-scoped fixture response',citations:[]}]},usage:{contextUnits:1,outputUnits:1,costEstimate:0,latencyMs:1},finishReason:'stop',provenance:provenance(req.correlationId)};}}});
    await kernel.start();
    await kernel.domains.create(principalId,{id:'business-scale',kind:'BUSINESS',name:'ScaleSmiths'});
    await kernel.domains.create(principalId,{id:'project-veterans',kind:'PROJECT',name:'VeteranFinder'});
    await kernel.domains.create(principalId,{id:'business-unrelated',kind:'BUSINESS',name:'Unrelated future work'});
    await kernel.domains.create(principalId,{id:'finance',kind:'FINANCIAL',name:'Personal finances'});
  });
  afterAll(async()=>{await ctx?.cleanup();});
  it('maintains unrelated objectives and agent jobs without making a business the root identity',async()=>{
    for(const domainId of ['business-scale','project-veterans','business-unrelated']){
      const objective=await kernel.objectives.create({principalId,domainId,statement:'Maintain '+domainId,origin:'principal',correlationId:'objective-'+domainId,provenance:provenance('objective-'+domainId)});
      expect(objective.domainId).toBe(domainId);
      await kernel.cognition.submit({principalId,domainId,objectiveId:objective.id,requestId:'job-'+domainId,correlationId:'job-'+domainId,input:'Help plan this activity',agentId:'agents.oracle',task:'reason',locality:'local'});
    }
    const rows=await ctx.pg.sql<{domain_id:string}[]>`select domain_id from cognition.agent_jobs where principal_id=${principalId} order by domain_id`;
    expect(rows.map(r=>r.domain_id)).toEqual(['business-scale','business-unrelated','project-veterans']);
    expect(requests).toHaveLength(3);
    expect(JSON.stringify(requests[2]!.input)).not.toContain('ScaleSmiths');
    const personal=await kernel.domains.resolve(principalId);
    expect(personal.kind).toBe('PERSONAL');
  });
  it('isolates ATLAS, MNEMOSYNE, name resolution and repeated preference keys',async()=>{
    for(const domainId of ['business-scale','project-veterans']){
      await kernel.knowledge.ingest({kind:'principal_assertion',principalId,domainId,correlationId:'fact-'+domainId,provenance:provenance('fact-'+domainId),fact:{subjectRef:'shared-name',attribute:'note',value:'private-'+domainId,epistemicStatus:'asserted',confidence:1,validFrom:'2026-09-01T00:00:00.000Z',evidenceRefs:[]}});
      await kernel.domains.run(principalId,{domainId},'pref-'+domainId,async()=>{
        await ctx.pg.sql`insert into mnemosyne.preferences(id,key,value,confidence,principal_id,domain_id) values(${domainId+'-pref'},'workflow.note',${JSON.stringify('private-'+domainId)},1,${principalId},${domainId})`;
      });
    }
    const compiled=await kernel.context.compile({principalId,domainId:'project-veterans',correlationId:'context-project',intent:'shared-name workflow',intentClass:'reason',budgetUnits:5000,maxPrivacyClass:'RESTRICTED'});
    expect(JSON.stringify(compiled)).toContain('private-project-veterans');
    expect(JSON.stringify(compiled)).not.toContain('private-business-scale');
    await kernel.domains.run(principalId,{domainId:'project-veterans'},'recall-project',async()=>{
      const recalled=await kernel.memory.recall({principalId,text:'workflow',k:20,floor:0});
      expect(recalled.items.length).toBeGreaterThan(0);
      expect(recalled.items.every(r=>r.item.domainId==='project-veterans')).toBe(true);
    });
  });
  it('requires explicit purpose-bound fusion, and never exports business-private or financial-private material',async()=>{
    await expect(kernel.context.compile({principalId,domainId:'project-veterans',sourceDomainIds:['business-scale'],correlationId:'mixed-denied',intent:'shared-name workflow',intentClass:'research',budgetUnits:5000,maxPrivacyClass:'RESTRICTED'})).rejects.toThrow('fusion grant');
    const grant=await kernel.domains.fusionGrant(principalId,{sourceDomainId:'business-scale',targetDomainId:'project-veterans',purpose:'research',expiresAt:new Date(Date.now()+60000).toISOString()});
    const mixed=await kernel.context.compile({principalId,domainId:'project-veterans',domainPurpose:'research',sourceDomainIds:['business-scale'],fusionGrantIds:[grant],correlationId:'mixed-granted',intent:'shared-name workflow',intentClass:'research',budgetUnits:5000,maxPrivacyClass:'RESTRICTED'});
    expect(JSON.stringify(mixed)).not.toContain('private-business-scale');
    await expect(kernel.domains.resolve(principalId,{domainId:'project-veterans',domainPurpose:'coding',sourceDomainIds:['business-scale'],fusionGrantIds:[grant]})).rejects.toThrow('fusion grant');
    await ctx.pg.sql`insert into mnemosyne.semantic(id,statement,confidence,provenance,privacy_class,principal_id,domain_id) values('business-public','public release information',1,${JSON.stringify(provenance('business-public'))},'PUBLIC',${principalId},'business-scale')`;
    const publicRecall=await kernel.memory.recall({principalId,domainId:'project-veterans',domainPurpose:'research',sourceDomainIds:['business-scale'],fusionGrantIds:[grant],text:'public release information',k:20,floor:0});
    expect(publicRecall.items.some(item=>item.item.domainId==='business-scale')).toBe(true);
    expect(JSON.stringify(publicRecall)).not.toContain('private-business-scale');
    await kernel.domains.revokeFusionGrant(principalId,grant);
    await expect(kernel.domains.resolve(principalId,{domainId:'project-veterans',domainPurpose:'research',sourceDomainIds:['business-scale'],fusionGrantIds:[grant]})).rejects.toThrow('fusion grant');
    await ctx.pg.sql`insert into mnemosyne.semantic(id,statement,confidence,provenance,privacy_class,principal_id,domain_id) values('finance-secret','financial private credential must never become coding context',1,${JSON.stringify(provenance('finance-secret'))},'RESTRICTED',${principalId},'finance')`;
    const finance=await kernel.context.compile({principalId,domainId:'finance',domainPurpose:'coding',correlationId:'finance-coding',intent:'financial private credential',intentClass:'code',budgetUnits:5000,maxPrivacyClass:'RESTRICTED'});
    expect(JSON.stringify(finance.items)).not.toContain('financial private credential');
  });
  it('rejects other principals, stale domain selections and immutable correlation reuse',async()=>{
    await expect(kernel.domains.get('another-principal','business-scale')).rejects.toThrow('domain access');
    const nodeId=kernel.config.nodeId;
    const first=await kernel.domains.switch(principalId,nodeId,'project-veterans',0);
    expect(first.version).toBe(1);
    await kernel.domains.switch(principalId,nodeId,'business-scale',1);
    await expect(kernel.context.compile({principalId,nodeId,domainSelectionVersion:1,correlationId:'stale-context',intent:'workflow',intentClass:'reason',budgetUnits:1000,maxPrivacyClass:'RESTRICTED'})).rejects.toThrow('stale domain');
    await kernel.domains.run(principalId,{domainId:'project-veterans'},'immutable-domain',async()=>undefined);
    await expect(kernel.domains.run(principalId,{domainId:'business-scale'},'immutable-domain',async()=>undefined)).rejects.toThrow('another domain');
  });
  it('keeps conversation history and replay identities in their original domain',async()=>{
    const service=new CompanionService({domains:kernel.domains,sql:ctx.pg.sql,snapshot:async()=>({principalId,stateVersion:1}) as never,cognize:req=>kernel.cognition.submit(req),now:()=>ctx.clock.nowIso(),id:()=>kernel.ids.ulid(),invalidate:()=>{}});
    const node={principalId,nodeId:kernel.config.nodeId};
    const first=await service.converse(node,{commandId:'domain-turn-a',domainId:'project-veterans',expectedStateVersion:1,input:'Private project discussion',locality:'local'});
    await expect(service.converse(node,{commandId:'domain-turn-b',domainId:'business-scale',expectedStateVersion:1,input:'Use that private discussion',locality:'local'},first.conversationId)).rejects.toThrow('conversation not found');
    await expect(service.converse(node,{commandId:'domain-turn-a',domainId:'business-scale',expectedStateVersion:1,input:'Private project discussion',locality:'local'})).rejects.toThrow();
    const next=await service.converse(node,{commandId:'domain-turn-c',domainId:'business-unrelated',expectedStateVersion:1,input:'Start independent work',locality:'local'});
    expect(next.conversationId).not.toBe(first.conversationId);
    expect(JSON.stringify(requests.at(-1)?.input)).not.toContain('Private project discussion');
  });
  it('filters personal retrieval before business ranking and rejects guessed foreign resource IDs',async()=>{
    await ctx.pg.sql`insert into mnemosyne.semantic(id,statement,confidence,privacy_class,principal_id,provenance) values('personal-secret','private personal material',1,'RESTRICTED',${principalId},${JSON.stringify(provenance('personal-secret'))})`;
    const business=await kernel.memory.recall({principalId,domainId:'business-scale',text:'personal',k:20,floor:0});
    expect(JSON.stringify(business)).not.toContain('private personal material');
    await expect(kernel.memory.recall({principalId:'other',domainId:'business-scale',text:'personal',k:20,floor:0})).rejects.toThrow();
    const [entity]=await ctx.pg.sql<{id:string}[]>`select id from atlas.entities where domain_id='business-scale' limit 1`;
    await kernel.domains.run(principalId,{domainId:'project-veterans'},'foreign-id-test',async()=>{
      expect(await new AtlasStore(ctx.pg.sql).getEntity(entity!.id)).toBeUndefined();
      await expect(new AtlasStore(ctx.pg.sql).addAlias(entity!.id,'unauthorised-alias','test')).rejects.toThrow('domain write');
      expect((await ctx.pg.sql`select alias from atlas.entity_aliases where entity_id=${entity!.id} and alias='unauthorised-alias'`)).toEqual([]);
      await expect(kernel.objectives.create({principalId,parentObjectiveId:(await ctx.pg.sql<{objective_id:string}[]>`select objective_id from projections.objectives where domain_id='business-scale' limit 1`)[0]!.objective_id,statement:'Invalid child',origin:'principal',correlationId:'foreign-id-test',provenance:provenance('foreign-id-test')})).rejects.toThrow('cross-domain parent');
    });
  });
  it('binds real persisted grants, tokens and secret references, and refuses financial credentials for coding',async()=>{
    const tokens=new PgTokenCache(ctx.pg.sql),invocations=new PgInvocationStore(ctx.pg.sql),grants=new PgGrantStore(ctx.pg.sql);
    const now=new Date().toISOString(),expiresAt=new Date(Date.now()+60000).toISOString();
    const broker=new CredentialBroker(new MemoryCredentialMaterialStore({bank:'controlled-test-secret'}),tokens,()=>new Date().toISOString(),ctx.pg.sql);
    await grants.put({id:'finance-grant',domainId:'finance',principalId,holder:{kind:'principal',id:principalId},scopes:['bank.read'],maxRiskWithoutLiveApproval:'LOW',mayProceedWithoutLiveApproval:true,version:1,issuedAt:now,resourceConstraints:[],nodeConstraints:[],timeWindows:[]});
    await ctx.pg.sql`insert into agency.secret_references(principal_id,provider,domain_id,secret_ref) values(${principalId},'bank','finance','test-fixture:bank')`;
    for(const purpose of ['coding','financial'] as const)await kernel.domains.run(principalId,{domainId:'finance',domainPurpose:purpose},'bank-'+purpose,async()=>{
      await invocations.create({invocationId:'bank-'+purpose,principalId,capabilityId:'capabilities.bank',capabilityVersion:'1.0.0',action:'read',state:'PROPOSED',correlationId:'bank-'+purpose,originActor:{kind:'principal',id:principalId},riskClass:'LOW',inputHash:'fixture',attemptCount:0,history:[]});
      await tokens.put({token:'test-token-'+purpose,invocationId:'bank-'+purpose,grantId:'finance-grant',grantVersion:1,principalId,scopes:['bank.read'],mode:'full',issuedAt:now,expiresAt});
      const mint=()=>broker.mint({authorityToken:'test-token-'+purpose,invocationId:'bank-'+purpose,capabilityId:'capabilities.bank',action:'read',resourceRef:'bank',mode:'full'});
      if(purpose==='coding')await expect(mint()).rejects.toThrow('financial credentials');
      else{const handle=await mint();expect(handle.domainId).toBe('finance');expect(JSON.stringify(handle)).not.toContain('controlled-test-secret');await kernel.domains.run(principalId,{domainId:'project-veterans'},'wrong-handle-domain',async()=>{expect(()=>broker.redeem(handle.handleId,handle.invocationId)).toThrow();});expect(broker.redeem(handle.handleId,handle.invocationId).use!(value=>value)).toBe('controlled-test-secret');}
    });
  });
  it('protects the agent explanation path from guessed IDs and forged principals',async()=>{
    const [fact]=await ctx.pg.sql<{id:string}[]>`select id from atlas.facts where domain_id='business-scale' limit 1`;
    await ctx.pg.sql`insert into atlas.evidence(id,subject_kind,subject_id,kind,ref,note,principal_id,domain_id) values('private-domain-evidence','fact',${fact!.id},'source_document','fixture:private','private client evidence',${principalId},'business-scale')`;
    await kernel.domains.run(principalId,{domainId:'business-scale'},'explain-authorised',async()=>{expect(JSON.stringify(await kernel.knowledgeFacade.explain(fact!.id,principalId))).toContain('private client evidence');});
    expect((await kernel.knowledgeFacade.explain(fact!.id,principalId)).evidence).toEqual([]);
    await kernel.domains.run(principalId,{domainId:'project-veterans'},'explain-denied',async()=>{
      expect((await kernel.knowledgeFacade.explain(fact!.id,principalId)).evidence).toEqual([]);
      await expect(kernel.knowledgeFacade.explain(fact!.id,'other')).rejects.toThrow('ownership');
      await expect(kernel.knowledgeFacade.query({principalId:'other',text:'client evidence',k:5})).rejects.toThrow('ownership');
    });
  });
  it('admits domain management only through authenticated principal/node authority',async()=>{
    const base=`http://${kernel.config.diagnosticsHost}:${kernel.diagnosticsPort}`;
    expect((await fetch(base+'/domains')).status).toBe(401);
    const exchange=await fetch(base+'/auth/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({credential:kernel.config.bootstrapCredential,nodeId:kernel.config.nodeId,scopes:['desktop.read','desktop.write'],surface:'desktop'})});
    expect(exchange.status).toBe(201);
    const issued=await exchange.json() as {accessToken:string;credential:{sessionId:string}};
    const headers={authorization:`Bearer ${issued.accessToken}`,'content-type':'application/json','x-jarvis-node-id':kernel.config.nodeId,'x-jarvis-session-id':issued.credential.sessionId};
    const current=await (await fetch(base+'/domains',{headers})).json() as {selection:{version:number};domains:Array<{principalId:string}>};
    expect(current.domains.every(domain=>domain.principalId===principalId)).toBe(true);
    expect((await fetch(base+'/domains',{method:'POST',headers,body:JSON.stringify({kind:'PROJECT',name:'Forged owner',principalId:'other'})})).status).toBe(400);
    const created=await fetch(base+'/domains',{method:'POST',headers,body:JSON.stringify({kind:'PROJECT',name:'Unrelated API activity'})});
    expect(created.status).toBe(201);const domain=await created.json() as {id:string;principalId:string};expect(domain.principalId).toBe(principalId);
    expect((await fetch(base+'/domains/select',{method:'POST',headers,body:JSON.stringify({domainId:domain.id,expectedVersion:current.selection.version})})).status).toBe(200);
    expect((await fetch(base+'/domains/select',{method:'POST',headers,body:JSON.stringify({domainId:domain.id,expectedVersion:current.selection.version})})).status).toBe(403);
    expect((await fetch(base+'/domains',{headers:{...headers,'x-jarvis-node-id':'another-node'}})).status).toBe(401);
  });
});
