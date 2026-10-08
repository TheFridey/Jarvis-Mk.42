import { createHash } from 'node:crypto';
import { isPublicWebRequest } from './public-web-request.ts';
import { EventNames, type CapabilityInvocationProposal, type CognitionRequest, type CognitionResponse, type InvocationResult } from '@jarvis/contracts';
import type { Sql } from '@jarvis/persistence';
import type { AgencyIngress } from '../agency-ingress/agency-ingress.ts';
import type { ContextCompiler } from '../context/context-compiler.ts';
import type { EventManager } from '../event-fabric/event-manager.ts';
import type { AgentRuntime } from './agent-runtime.ts';
/** Kernel-authored, from the Executor's InvocationResult; the model never learns or states these outcomes itself. */
export function capabilityStatus(proposal: CapabilityInvocationProposal, result: InvocationResult): string {
  const input = proposal.invocation.input as { url?: unknown } | undefined;
  const target = typeof input?.url === 'string' ? ` for ${input.url}` : '';
  const outcome: Record<InvocationResult['outcome'], string> = {
    awaiting_approval: 'is awaiting your approval in the JARVIS approval panel; nothing has run yet', verified: 'ran and was verified by the Executor',
    rejected: 'was rejected by Kernel validation', denied: 'was denied by Kernel policy or permissions', aborted: 'was aborted by the Executor', failed: 'failed during execution',
    verification_failed: 'ran but failed Executor verification', rolled_back: 'was rolled back after failed verification', partially_completed: 'partially completed',
    compensated: 'was compensated after a failed step', simulated: 'was simulated only',
  };
  const followUp = result.outcome === 'awaiting_approval' && proposal.invocation.capabilityId === 'capabilities.web' ? ' Findings will arrive as a separate response after it runs and is verified.' : '';
  return `JARVIS Kernel: ${proposal.invocation.capabilityId}/${proposal.invocation.action}${target} ${outcome[result.outcome]} (invocation ${result.invocationId}).${followUp}`;
}
export function cognitionIdentity(req: CognitionRequest, cloudAllowed: boolean): string {
  const scope=req.contextScope??null;
  const identity:unknown[]=[req.requestId,req.principalId,req.correlationId,req.agentId,req.input,req.task,req.locality??'any',req.maxCost??null,req.maxLatencyMs??null,req.realtime??false,req.cloudAllowed??cloudAllowed,req.preferredModels??[],req.preferredProviders??[],req.objectiveId??null,req.parentJobId??null,req.workflowRef??null];if(req.perceptionRef||req.analysisOnly)identity.push(req.perceptionRef??null,req.analysisOnly??false);if(req.evidenceRef)identity.push(req.evidenceRef);if(scope)identity.push({contextScope:scope});return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}
export class CognitionOrchestrator {
  private readonly inFlight = new Set<string>();
  constructor(private readonly d:{sql:Sql;context:ContextCompiler;runtime:AgentRuntime;agency:AgencyIngress;events:EventManager;now:()=>string;cloudAllowed:boolean;
    deliverContinuation?:(response:CognitionResponse,parentJobId:string)=>Promise<CognitionResponse>;
    /** True when a policy-permitted local model route exists. RESTRICTED context
     *  fails closed when this is false — it is never downgraded to cloud. */
    localModelAvailable?:()=>boolean;research?:{remember(req:CognitionRequest,proposal:CapabilityInvocationProposal):void};businessAnswer?:(principalId:string,text:string,correlationId:string)=>Promise<string|{answer:string;modelId:string;agentId:'agents.nova'|'agents.sentinel'}|undefined>}){}
  cancelAgentJob(jobId: string, principalId: string) { return this.d.runtime.cancelForPrincipal(jobId, principalId); }
  async submit(req:CognitionRequest):Promise<CognitionResponse>{
    if (this.inFlight.has(req.requestId)) throw new Error('cognition request already in progress');
    this.inFlight.add(req.requestId);
    try { return await this.process(req); } finally { this.inFlight.delete(req.requestId); }
  }
  private async process(req:CognitionRequest):Promise<CognitionResponse>{
    if(!req.contextScope&&!req.perceptionRef&&!req.evidenceRef&&isPublicWebRequest(req.input))req={...req,contextScope:'public-web'};
    const created=this.d.now(), hash=createHash('sha256').update(req.perceptionRef||req.analysisOnly?JSON.stringify([req.input,req.perceptionRef??null,req.analysisOnly??false]):req.input).digest('hex');
    const inserted=await this.d.sql<{request_id:string}[]>`insert into cognition.runs(request_id,principal_id,correlation_id,agent_id,status,input_hash,task_class,objective_ref,workflow_ref,created_at) values(${req.requestId},${req.principalId},${req.correlationId},${req.agentId},'running',${hash},${req.task},${req.objectiveId??null},${req.workflowRef??null},${created}) on conflict(request_id) do nothing returning request_id`;
    if(inserted.length===0){
      const[existing]=await this.d.sql<Array<{status:string;response:CognitionResponse|null;input_hash:string;principal_id:string;agent_id:string;correlation_id:string;task_class:string}>>`select status,response,input_hash,principal_id,agent_id,correlation_id,task_class from cognition.runs where request_id=${req.requestId}`;
      if(existing?.input_hash!==hash||existing.principal_id!==req.principalId||existing.agent_id!==req.agentId||existing.task_class!==req.task)throw new Error('cognition request id is bound to different input, principal or agent task');
      if(existing.status==='completed'&&existing.response)return existing.response;
      if(!await this.d.runtime.canRecover(req.requestId,req.principalId,req.agentId))throw new Error('cognition request already in progress or failed');
      req={...req,correlationId:existing.correlation_id};
      await this.d.sql`update cognition.runs set status='running',error_code=null,finished_at=null where request_id=${req.requestId}`;
    }
    // Purpose/budgets are immutable; fresh Context Packages may be recompiled.
    const identityHash=cognitionIdentity(req,this.d.cloudAllowed);
    try{
    await this.emit(EventNames.CognitionStarted,req,{agentId:req.agentId});
      const businessAnswer = !req.analysisOnly ? await this.d.businessAnswer?.(req.principalId,req.input,req.correlationId) : undefined;
      if (businessAnswer !== undefined) {
        const direct=typeof businessAnswer==='string'?{answer:businessAnswer,modelId:'nova:operating-picture',agentId:'agents.nova' as const}:businessAnswer;
        const out:CognitionResponse={requestId:req.requestId,principalId:req.principalId,correlationId:req.correlationId,modelId:direct.modelId,answer:direct.answer,createdAt:created,result:{jobId:req.requestId,agentId:direct.agentId,principalId:req.principalId,correlationId:req.correlationId,status:'completed',proposals:[],evidence:[],startedAt:created,finishedAt:this.d.now()}};
        await this.d.sql`update cognition.runs set model_id=${out.modelId},status='completed',response=${JSON.stringify(out)},privacy_class='RESTRICTED',finished_at=${this.d.now()} where request_id=${req.requestId}`;
        await this.emit(EventNames.CognitionCompleted,req,{modelId:out.modelId,proposalCount:0});await this.emit(EventNames.CognitionResultDelivered,req,{requestId:req.requestId,hasAnswer:true});return out;
      }
      // Compile with the ceiling wide open so ATLAS/MNEMOSYNE knowledge is not
      // dropped before routing can consider it; the package's own maxPrivacyClass
      // then drives model locality (privacy-aware routing, not label loosening).
      const context=await this.d.context.compile({correlationId:req.correlationId,intent:req.input,intentClass:req.task,budgetUnits:req.evidenceRef?9000:4000,maxPrivacyClass:req.contextScope==='public-web'?'PUBLIC':'RESTRICTED',...(req.contextScope?{scope:req.contextScope}:{}),principalId:req.principalId,perceptionRef:req.perceptionRef,...(req.evidenceRef?{evidenceRef:req.evidenceRef}:{})});
      const pc=context.maxPrivacyClass, sensitive=pc==='SENSITIVE'||pc==='RESTRICTED';
      if(pc==='RESTRICTED'&&!(this.d.localModelAvailable?.()??false)){
        throw new Error('context contains RESTRICTED knowledge and no policy-permitted local model route is available — refusing to route (privacy fail-closed)');
      }
      const locality=sensitive?'local':(req.locality??'any');
      const cloudAllowed=sensitive?false:(req.cloudAllowed??this.d.cloudAllowed);
      await this.emit(EventNames.CognitionAgentInvoked,req,{agentId:req.agentId,contextId:context.id,contextUnits:context.budget.usedUnits,maxPrivacyClass:pc,locality,cloudAllowed});
      const {result,response}=await this.d.runtime.invoke(req.agentId,{task:req.task,capabilities:['json'],input:{instruction:req.input,context,constraints:['Return JSON with a proposals array','Never claim to execute tools or capabilities','Every proposal must include complete provenance and correlationId']},budget:{contextUnits:context.budget.usedUnits,maxOutput:2000,...(req.maxCost!==undefined?{maxCost:req.maxCost}:{}),...(req.maxLatencyMs!==undefined?{maxLatencyMs:req.maxLatencyMs}:{})},locality,determinism:'low-temp',correlationId:req.correlationId,principalId:req.principalId,privacyClass:pc,realtime:req.realtime,cloudAllowed,preferredModels:req.preferredModels??(process.env.JARVIS_PREFERRED_MODELS??'gpt-6.1-sol').split(',').map(id=>id.trim()).filter(Boolean),operatorPreferences:{preferredProviders:req.preferredProviders}},async routing=>{await this.d.sql`update cognition.runs set privacy_class=${pc},routing_observability=${JSON.stringify(routing)},model_id=${routing.selectedModelId??null} where request_id=${req.requestId}`;if(routing.selectedModelId)await this.emit(EventNames.CognitionModelSelected,req,{phase:routing.phase,modelId:routing.selectedModelId,candidates:routing.candidates.map(candidate=>({modelId:candidate.modelId,state:candidate.state,reason:candidate.reason})),selectionReason:routing.selectionReason});}, { jobId: req.requestId, objectiveId: req.objectiveId, parentJobId: req.parentJobId, identityHash });
      const answer=result.proposals.find(p=>p.kind==='answer');
      for(const proposal of result.proposals)await this.emit(EventNames.CognitionProposalCreated,req,{proposalId:proposal.proposalId,kind:proposal.kind,confidence:proposal.confidence});
      await this.emit(EventNames.CognitionEvidenceReturned,req,{count:result.evidence.length,refs:result.evidence});
      await this.emit(EventNames.CognitionOutputValidated,req,{proposalCount:result.proposals.length});
      const statuses:string[]=[];
      for(const p of result.proposals)if(p.kind==='capability_invocation'&&!req.analysisOnly){const proposal=p as CapabilityInvocationProposal;this.d.research?.remember(req,proposal);statuses.push(capabilityStatus(proposal,await this.d.agency.submitOnce(proposal,{principalId:req.principalId,authenticated:true})));}
      if(req.analysisOnly)result.proposals=result.proposals.filter(p=>p.kind!=='capability_invocation');
      const answerText=[...(answer?.kind==='answer'?[answer.text]:[]),...statuses].join('\n\n');
      let out:CognitionResponse={requestId:req.requestId,principalId:req.principalId,correlationId:req.correlationId,result,modelId:response.modelId,...(answerText?{answer:answerText}:{}),createdAt:created};
      if(req.parentJobId&&this.d.deliverContinuation)out=await this.d.deliverContinuation(out,req.parentJobId);
      await this.d.sql`update cognition.runs set model_id=${response.modelId},status='completed',response=${JSON.stringify(out)},privacy_class=${pc},routing_observability=${response.routing?JSON.stringify(response.routing):null},usage_observability=${JSON.stringify(response.usage)},first_token_at=${response.routing?.firstTokenAt??null},context_units=${response.usage.contextUnits},output_units=${response.usage.outputUnits},cost_estimate=${response.usage.costEstimate},latency_ms=${response.usage.latencyMs},finished_at=${this.d.now()} where request_id=${req.requestId}`;
      await this.emit(EventNames.CognitionCompleted,req,{modelId:response.modelId,proposalCount:result.proposals.length});await this.emit(EventNames.CognitionResultDelivered,req,{requestId:req.requestId,hasAnswer:Boolean(out.answer)});return out;
    }catch(e){const errorClass=typeof e==='object'&&e!==null&&'code'in e?String(e.code):e instanceof Error?e.name:'error';await this.d.sql`update cognition.runs set status='failed',error_code=${errorClass},finished_at=${this.d.now()} where request_id=${req.requestId}`;await this.emit(EventNames.CognitionRejected,req,{error:e instanceof Error?e.message:String(e),errorClass});throw e;}
  }
  private async emit(type:string,req:CognitionRequest,payload:unknown){await this.d.events.emit({type:type as never,retentionClass:'AUDIT',privacyClass:'INTERNAL',subject:{kind:'cognition-run',id:req.requestId},actor:{kind:'agent',id:req.agentId,onBehalfOf:req.principalId},correlationId:req.correlationId,causationId:req.requestId,principalId:req.principalId,payload})}
}
