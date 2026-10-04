import { expect, it, vi } from 'vitest';
import { DesktopGateway } from './desktop-gateway.ts';
it('does not turn persistence defaults into measured usage on a failed run',async()=>{
 const gateway=new DesktopGateway({
  sql:async(strings:TemplateStringsArray)=>strings.join('').includes('from cognition.runs')?[{request_id:'failed-run',correlation_id:'correlation',agent_id:'agents.oracle',model_id:null,status:'failed',created_at:'2026-10-01T00:00:00.000Z',finished_at:'2026-10-01T00:00:01.000Z',context_units:0,output_units:0,cost_estimate:0,latency_ms:0,usage_observability:null,error_code:'NO_ROUTE'}]:[],
  diagnostics:{report:async()=>({generatedAt:'2026-10-01T00:00:01.000Z',mode:'AMBIENT',ok:true,nodes:{ids:[]},dependencies:[],health:{overall:'HEALTHY'},events:{ratePerMinute:0}})},
  state:{view:async()=>({stateVersion:0,slices:{}})},sessions:{listActive:async()=>[]},approvals:{listPending:async()=>[]},
 } as never);
 const picture=await gateway.snapshot();
 expect(picture.recentModelRuns[0]).toMatchObject({requestId:'failed-run',errorClass:'NO_ROUTE'});
 expect(picture.recentModelRuns[0]?.latencyMs).toBeUndefined();
 expect(picture.recentModelRuns[0]?.contextUnits).toBeUndefined();
 expect(picture.recentModelRuns[0]?.costEstimate).toBeUndefined();
});
function projection(records:{jobs:unknown[];runs?:unknown[];effects?:unknown[]}) {
 return new DesktopGateway({sql:async(strings:TemplateStringsArray)=>{const query=strings.join('');return query.includes('from cognition.runs')?records.runs??[]:query.includes('from cognition.agent_jobs')?records.jobs:query.includes('from agency.invocations')?records.effects??[]:[]},
  diagnostics:{report:async()=>({generatedAt:'2026-10-02T00:00:01.000Z',mode:'AMBIENT',ok:true,nodes:{ids:[]},dependencies:[],health:{overall:'HEALTHY'},events:{ratePerMinute:0}})},state:{view:async()=>({stateVersion:1,slices:{}})},sessions:{listActive:async()=>[]},approvals:{listPending:async()=>[]}} as never);
}
const observedJob = {job_id:'job',agent_id:'agents.forge',correlation_id:'c',task_class:'code',state:'RUNNING',attempt:1,started_at:'2026-10-02T00:00:00.000Z',finished_at:null,last_heartbeat:'2026-10-02T00:00:00.000Z',deadline:'2026-10-02T00:01:00.000Z',wall_ms:60000,context_units:100,cost_limit:1,proposal_count:0,evidence_refs:[],activity_confirmed:false,inference_started:true,result:null};
it('does not present a persisted running cognition row as a live worker without lease confirmation',async()=>{
 const picture=await projection({jobs:[observedJob],runs:[{request_id:'job',correlation_id:'c',agent_id:'agents.forge',model_id:'observed-model',status:'running',created_at:'2026-10-02T00:00:00.000Z'}]}).snapshot();
 expect(picture.activeModels).toEqual([]);expect(picture.activeAgents).toEqual([]);expect(picture.workState).toBe('WAITING');expect(picture.recentModelRuns[0]?.activityConfirmed).toBe(false);
});
it('derives verification from a linked Executor record rather than cognitive completion',async()=>{
 const proposal={proposalId:'sealed-id',kind:'capability_invocation',invocation:{capabilityId:'capabilities.test'}};
 const picture=await projection({jobs:[{...observedJob,state:'COMPLETE',proposal_count:1,result:{result:{proposals:[proposal]}}}],effects:[{invocation_id:'effect',capability_id:'capabilities.test',action:'write',state:'VERIFYING',origin_actor:{id:'p'},risk_class:'MEDIUM',proposal,updated_at:'2026-10-02T00:00:01.000Z',finished_at:null,manifest:null}]}).snapshot();
 expect(picture.agentJobs?.[0]).toMatchObject({state:'COMPLETE',activityStage:'VERIFYING',capabilityActivity:[{invocationId:'effect',state:'VERIFYING'}]});expect(picture.workState).toBe('VERIFYING');
});
it('bounds projected references while retaining the real durable evidence count',async()=>{
 const picture=await projection({jobs:[{...observedJob,evidence_refs:['x'.repeat(300),...Array.from({length:20},(_,n)=>`ref-${n}`)]}]}).snapshot();
 expect(picture.agentJobs?.[0]).toMatchObject({evidenceCount:21,evidenceRefsTruncated:true});expect(picture.agentJobs?.[0]?.evidenceRefs).toHaveLength(8);
});
it('projects gateway routing rejections for a failed job that never selected a model',async()=>{
 const unavailable=(modelId:string)=>({modelId,state:'UNAVAILABLE',reason:'privacy/locality requires local execution'});
 const picture=await projection({jobs:[{...observedJob,state:'FAILED',error_code:'NO_ROUTE',model_route:{phase:'CANDIDATE',candidates:[unavailable('gpt-5'),unavailable('claude-sonnet-4-5')]}}]}).snapshot();
 expect(picture.agentJobs?.[0]).toMatchObject({errorCode:'NO_ROUTE',routeRejections:['gpt-5: privacy/locality requires local execution','claude-sonnet-4-5: privacy/locality requires local execution']});
 expect(picture.agentJobs?.[0]?.selectedModelId).toBeUndefined();
});
it('binds cancellation to the authenticated principal, not a client-supplied principal field',async()=>{
 const cancelAgentJob=vi.fn(async()=>true);
 const gateway=new DesktopGateway({state:{view:async()=>({stateVersion:1})},cognition:{cancelAgentJob}} as never);
 await gateway.cancelAgentJob({commandId:'cancel',jobId:'job',expectedStateVersion:1,principalId:'forged'} as never,'authenticated');
 expect(cancelAgentJob).toHaveBeenCalledWith('job','authenticated');
 const stale=await gateway.cancelAgentJob({commandId:'stale',jobId:'job',expectedStateVersion:0},'authenticated');expect(stale.ok).toBe(false);expect(cancelAgentJob).toHaveBeenCalledTimes(1);
});
