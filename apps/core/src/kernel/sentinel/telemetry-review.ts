import { createHash } from 'node:crypto';
import type { ContextPackage } from '@jarvis/contracts';
import type { SystemTelemetrySnapshot } from '@jarvis/scene';
import type { AgentRuntime } from '../cognition/agent-runtime.ts';
import { withSpan } from '@jarvis/telemetry';
// Only unexplained, sustained queue growth while dependencies appear healthy
// warrants reasoning. One local, bounded review per 15 minutes; no effect path.
export class TelemetryReview {
  private lastAt?:string;private previousQueue?:number;private growth=0;private lastReview=0;private busy=false;private contextVersion=0;
  async review(snapshot:SystemTelemetrySnapshot,deps:{runtime:AgentRuntime;principalId:string;correlationId:string;localAvailable:boolean}):Promise<{reviewed:boolean;proposalCount:number}|undefined>{
    if(this.lastAt===snapshot.generatedAt)return;this.lastAt=snapshot.generatedAt;
    const queue=snapshot.readings.queue;
    if(queue?.status!=='available'||queue.value===null){this.growth=0;return;}
    this.growth=this.previousQueue!==undefined&&queue.value>this.previousQueue?this.growth+1:0;this.previousQueue=queue.value;
    if(this.growth<3||snapshot.readings.postgres?.value!==1||snapshot.readings.redis?.value!==1||!deps.localAvailable||this.busy||Date.now()-this.lastReview<900000)return;
    this.lastReview=Date.now();this.busy=true;
    try{return await withSpan('kernel.telemetry.review',{'jarvis.correlation_id':deps.correlationId},async()=>{
      const evidence=Object.fromEntries(Object.entries(snapshot.readings).filter(([,r])=>r.status==='available').map(([key,r])=>[key,{value:r.value,unit:r.unit}]));
      const statement='Review unexplained sustained queue growth. Return diagnostic answer proposals only. No remediation. Numeric evidence: '+JSON.stringify(evidence);
      const context=await withSpan<ContextPackage>('context.telemetry',{'jarvis.correlation_id':deps.correlationId},async()=>{
        const content=JSON.stringify(evidence),usedUnits=Math.ceil(content.length/3);
        if(usedUnits>4000)throw new Error('telemetry evidence exceeds context budget');
        return {id:deps.correlationId,version:++this.contextVersion,request:{correlationId:deps.correlationId,intent:'Review sustained queue growth',intentClass:'reason',budgetUnits:4000,maxPrivacyClass:'INTERNAL'},compiledAt:snapshot.generatedAt,
          items:[{id:deps.correlationId,kind:'evidence',summary:'Numeric system telemetry',content:evidence,provenance:{method:'system',producedBy:'system-telemetry',producedOn:'kernel',producedAt:snapshot.generatedAt,correlationId:deps.correlationId,derivedFromUntrusted:false},privacyClass:'INTERNAL',relevance:1,sizeUnits:usedUnits,contentHash:createHash('sha256').update(content).digest('hex'),sourceType:'derivation'}],
          budget:{limitUnits:4000,usedUnits,truncated:false,omitted:[]},unknowns:['Root cause is not established'],filtered:{byPrivacy:0,byDedupe:0},maxPrivacyClass:'INTERNAL'};
      });
      const {result}=await deps.runtime.invoke('agents.argus',{task:'reason',capabilities:['json'],input:{instruction:statement,context,constraints:['Return diagnostic answer proposals only. Never invoke a capability.']},budget:{contextUnits:4000,maxOutput:500,maxCost:0.05,maxLatencyMs:10000},locality:'local',cloudAllowed:false,privacyClass:'INTERNAL',correlationId:deps.correlationId,principalId:deps.principalId});
      // The reviewer returns counts, never routes any proposal to AgencyIngress.
      return {reviewed:true,proposalCount:result.proposals.filter(p=>p.kind==='answer').length};
    });}finally{this.busy=false;}
  }
}
