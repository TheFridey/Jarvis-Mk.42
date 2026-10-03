import { ModelGatewayError, type ModelRegistration, type ModelRequest, type ModelRouteCandidate } from '@jarvis/contracts';
import type { ProviderAdapter } from './provider.ts';
import { CircuitBreaker } from './circuit-breaker.ts';

export interface RegisteredModel{model:ModelRegistration;adapter:ProviderAdapter;breaker:CircuitBreaker;healthy:boolean;observedHealth?:ModelRouteCandidate['healthState'];observedLatencyMs?:number}
export interface RoutingEvaluation{eligible:RegisteredModel[];candidates:ModelRouteCandidate[]}

export class ModelRegistry{
  private models=new Map<string,RegisteredModel>();
  register(model:ModelRegistration,adapter:ProviderAdapter){if(model.provider!==adapter.provider)throw new Error('provider mismatch');this.models.set(model.id,{model,adapter,breaker:new CircuitBreaker(),healthy:true})}
  get(id:string){return this.models.get(id)}all(){return[...this.models.values()]}
  evaluate(request:ModelRequest):RoutingEvaluation{
    const localOnly=request.locality==='local'||request.cloudAllowed===false||['SENSITIVE','RESTRICTED'].includes(request.privacyClass??'INTERNAL');
    const evaluated=this.all().map(entry=>{const policyReason=this.rejection(entry,request,localOnly);const overBudget=policyReason===undefined&&request.budget.maxCost!==undefined&&this.cost(entry.model,request)>request.budget.maxCost;const reason=policyReason??(overBudget?'cost exceeds request budget':undefined);return{entry,policyReason,reason,score:reason===undefined?this.score(entry,request):undefined}});
    const localityEligible=evaluated.filter(item=>item.policyReason===undefined);
    const affordable=localityEligible.filter(item=>item.reason===undefined);
    if(localityEligible.length&&affordable.length===0)throw new ModelGatewayError('BUDGET_EXCEEDED','all eligible models exceed request budget',false);
    const eligible=affordable.sort((a,b)=>a.score!-b.score!).map(item=>item.entry);
    const candidates:ModelRouteCandidate[]=evaluated.map(({entry,reason,score})=>({modelId:entry.model.id,displayName:entry.model.displayName,provider:entry.model.provider,locality:entry.model.locality,state:reason?'UNAVAILABLE':'CANDIDATE',reason:reason??this.selectionReason(entry,request),...(score!==undefined?{score}:{}),estimatedCost:this.cost(entry.model,request),contextLimitUnits:entry.model.contextLimitUnits,toolSupport:entry.model.capabilities.includes('tools')||entry.model.capabilities.includes('function_calling'),visionSupport:entry.model.capabilities.includes('vision'),...(entry.model.reasoningDepth?{reasoningMode:entry.model.reasoningDepth}:{}),healthState:entry.observedHealth??'unknown',circuitBreaker:entry.breaker.state}));
    return{eligible,candidates};
  }
  candidates(request:ModelRequest){return this.evaluate(request).eligible}
  route(request:ModelRequest){return this.candidates(request)[0]}
  private rejection(entry:RegisteredModel,request:ModelRequest,localOnly:boolean):string|undefined{const model=entry.model;if(!model.enabled)return'model disabled';if(!entry.healthy)return'endpoint unhealthy';if(!entry.breaker.canAttempt())return'circuit breaker open';if(!model.tasks.includes(request.task))return`task ${request.task} unsupported`;const missing=request.capabilities.find(capability=>!model.capabilities.includes(capability));if(missing)return`capability ${missing} unsupported`;if(model.contextLimitUnits<request.budget.contextUnits)return'context limit insufficient';if(request.realtime&&model.realtimeSuitable===false)return'not suitable for realtime';const tool=request.toolRequirements?.find(id=>!model.toolIds?.includes(id));if(tool)return`tool ${tool} unavailable`;if(localOnly&&model.locality!=='local')return'privacy/locality requires local execution';return undefined}
  private selectionReason(entry:RegisteredModel,request:ModelRequest){if(request.preferredModels?.includes(entry.model.id))return'operator preferred model';if(request.operatorPreferences?.preferredProviders?.includes(entry.model.provider))return'operator preferred provider';if(request.locality==='prefer-local'&&entry.model.locality==='local')return'local model preferred';if(request.operatorPreferences?.optimizeFor==='cost')return'eligible route ordered by estimated cost';if(request.operatorPreferences?.optimizeFor==='latency')return'eligible route ordered by observed latency';if(request.task==='reason'&&entry.model.reasoningDepth==='deep'&&!request.realtime)return'deep reasoning match';return'best eligible policy score'}
  private cost(model:ModelRegistration,request:ModelRequest){return model.costPerContextUnit*request.budget.contextUnits+model.costPerOutputUnit*request.budget.maxOutput}
  private score(entry:RegisteredModel,request:ModelRequest){const preferred=request.preferredModels?.indexOf(entry.model.id)??-1,provider=request.operatorPreferences?.preferredProviders?.indexOf(entry.model.provider)??-1,local=request.locality==='prefer-local'&&entry.model.locality==='local'?-500:0,latency=entry.observedLatencyMs??1000,cost=this.cost(entry.model,request)*100;return(preferred>=0?preferred*-1000:0)+(provider>=0?provider*-750:0)+local+(request.operatorPreferences?.optimizeFor==='cost'?cost*10:cost)+(request.operatorPreferences?.optimizeFor==='latency'?latency*2:latency)+(request.task==='reason'&&entry.model.reasoningDepth==='deep'&&!request.realtime?-250:0)}
}
