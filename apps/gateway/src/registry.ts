import { ModelGatewayError, type ModelRegistration, type ModelRequest } from '@jarvis/contracts'; import type { ProviderAdapter } from './provider.ts'; import { CircuitBreaker } from './circuit-breaker.ts';
export interface RegisteredModel{model:ModelRegistration;adapter:ProviderAdapter;breaker:CircuitBreaker;healthy:boolean;observedLatencyMs?:number}
export class ModelRegistry{
 private models=new Map<string,RegisteredModel>(); register(model:ModelRegistration,adapter:ProviderAdapter){if(model.provider!==adapter.provider)throw new Error('provider mismatch');this.models.set(model.id,{model,adapter,breaker:new CircuitBreaker(),healthy:true})}get(id:string){return this.models.get(id)}all(){return[...this.models.values()]}
 candidates(request:ModelRequest){
  const base=this.all().filter(({model,breaker,healthy})=>model.enabled&&healthy&&breaker.canAttempt()&&model.tasks.includes(request.task)&&request.capabilities.every(c=>model.capabilities.includes(c))&&model.contextLimitUnits>=request.budget.contextUnits&&!(request.realtime&&model.realtimeSuitable===false)&&!(request.toolRequirements?.some(t=>!model.toolIds?.includes(t))));
  const localOnly=request.locality==='local'||request.cloudAllowed===false||['SENSITIVE','RESTRICTED'].includes(request.privacyClass??'INTERNAL');
  const locality=base.filter(({model})=>!(localOnly&&model.locality!=='local'));
  const affordable=locality.filter(({model})=>request.budget.maxCost===undefined||this.cost(model,request)<=request.budget.maxCost);
  if(locality.length&&affordable.length===0)throw new ModelGatewayError('BUDGET_EXCEEDED','all eligible models exceed request budget',false);
  return affordable.sort((a,b)=>this.score(a,request)-this.score(b,request));
 }
 route(request:ModelRequest){return this.candidates(request)[0]}
 private cost(m:ModelRegistration,r:ModelRequest){return m.costPerContextUnit*r.budget.contextUnits+m.costPerOutputUnit*r.budget.maxOutput}
 private score(e:RegisteredModel,r:ModelRequest){const preferred=r.preferredModels?.indexOf(e.model.id)??-1,provider=r.operatorPreferences?.preferredProviders?.indexOf(e.model.provider)??-1,local=r.locality==='prefer-local'&&e.model.locality==='local'?-500:0,latency=e.observedLatencyMs??1000,cost=this.cost(e.model,r)*100;return(preferred>=0?preferred*-1000:0)+(provider>=0?provider*-750:0)+local+(r.operatorPreferences?.optimizeFor==='cost'?cost*10:cost)+(r.operatorPreferences?.optimizeFor==='latency'?latency*2:latency)+(r.task==='reason'&&e.model.reasoningDepth==='deep'&&!r.realtime?-250:0)}
}
