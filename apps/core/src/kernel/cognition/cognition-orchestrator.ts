import { createHash } from 'node:crypto';
import { EventNames, type CapabilityInvocationProposal, type CognitionRequest, type CognitionResponse } from '@jarvis/contracts';
import type { Sql } from '@jarvis/persistence';
import type { AgencyIngress } from '../agency-ingress/agency-ingress.ts';
import type { ContextCompiler } from '../context/context-compiler.ts';
import type { EventManager } from '../event-fabric/event-manager.ts';
import type { AgentRuntime } from './agent-runtime.ts';
export class CognitionOrchestrator {
  constructor(private readonly d:{sql:Sql;context:ContextCompiler;runtime:AgentRuntime;agency:AgencyIngress;events:EventManager;now:()=>string}){}
  async submit(req:CognitionRequest):Promise<CognitionResponse>{
    const created=this.d.now(), hash=createHash('sha256').update(req.input).digest('hex');
    const inserted=await this.d.sql<{request_id:string}[]>`insert into cognition.runs(request_id,principal_id,correlation_id,agent_id,status,input_hash,created_at) values(${req.requestId},${req.principalId},${req.correlationId},${req.agentId},'running',${hash},${created}) on conflict(request_id) do nothing returning request_id`;
    if(inserted.length===0){const[existing]=await this.d.sql<Array<{status:string;response:CognitionResponse|null;input_hash:string;principal_id:string}>>`select status,response,input_hash,principal_id from cognition.runs where request_id=${req.requestId}`;if(existing?.input_hash!==hash||existing.principal_id!==req.principalId)throw new Error('cognition request id is bound to different input or principal');if(existing.status==='completed'&&existing.response)return existing.response;throw new Error('cognition request already in progress or failed')}
    await this.emit(EventNames.CognitionStarted,req,{agentId:req.agentId});
    try{
      const context=await this.d.context.compile({correlationId:req.correlationId,intent:req.input,intentClass:req.task,budgetUnits:4000,maxPrivacyClass:'INTERNAL'});
      const {result,response}=await this.d.runtime.invoke(req.agentId,{task:req.task,capabilities:['json'],input:{instruction:req.input,context,constraints:['Return JSON with a proposals array','Never claim to execute tools or capabilities','Every proposal must include complete provenance and correlationId']},budget:{contextUnits:context.budget.usedUnits,maxOutput:2000,...(req.maxCost!==undefined?{maxCost:req.maxCost}:{}),...(req.maxLatencyMs!==undefined?{maxLatencyMs:req.maxLatencyMs}:{})},locality:req.locality??'any',determinism:'low-temp',correlationId:req.correlationId,principalId:req.principalId,privacyClass:'INTERNAL'});
      for(const p of result.proposals)if(p.kind==='capability_invocation')await this.d.agency.submit(p as CapabilityInvocationProposal,{principalId:req.principalId,authenticated:true});
      const answer=result.proposals.find(p=>p.kind==='answer');
      const out:CognitionResponse={requestId:req.requestId,principalId:req.principalId,correlationId:req.correlationId,result,modelId:response.modelId,...(answer?.kind==='answer'?{answer:answer.text}:{}),createdAt:created};
      await this.d.sql`update cognition.runs set model_id=${response.modelId},status='completed',response=${JSON.stringify(out)},context_units=${response.usage.contextUnits},output_units=${response.usage.outputUnits},cost_estimate=${response.usage.costEstimate},latency_ms=${response.usage.latencyMs},finished_at=${this.d.now()} where request_id=${req.requestId}`;
      await this.emit(EventNames.CognitionCompleted,req,{modelId:response.modelId,proposalCount:result.proposals.length});return out;
    }catch(e){await this.d.sql`update cognition.runs set status='failed',error_code=${e instanceof Error?e.name:'error'},finished_at=${this.d.now()} where request_id=${req.requestId}`;await this.emit(EventNames.CognitionRejected,req,{error:e instanceof Error?e.message:String(e)});throw e;}
  }
  private async emit(type:string,req:CognitionRequest,payload:unknown){await this.d.events.emit({type:type as never,retentionClass:'AUDIT',privacyClass:'INTERNAL',subject:{kind:'cognition-run',id:req.requestId},actor:{kind:'agent',id:req.agentId,onBehalfOf:req.principalId},correlationId:req.correlationId,causationId:req.requestId,principalId:req.principalId,payload}).catch(()=>undefined)}
}
