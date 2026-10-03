import { describe,expect,it } from 'vitest'; import type { ModelRegistration,ModelRequest } from '@jarvis/contracts'; import { ModelGateway } from './gateway.ts'; import { ModelRegistry } from './registry.ts'; import type { ProviderAdapter } from './provider.ts';
const req=(over:Partial<ModelRequest>={}):ModelRequest=>({task:'reason',capabilities:['json'],input:{instruction:'x',context:{} as never,constraints:[]},budget:{contextUnits:10,maxOutput:10,maxCost:1},locality:'any',correlationId:'c',principalId:'p',...over});
const model=(id:string,locality:ModelRegistration['locality'],provider='test'):ModelRegistration=>({id,provider,displayName:id,tasks:['reason'],capabilities:['json','streaming'],contextLimitUnits:100,costPerContextUnit:0.001,costPerOutputUnit:0.001,locality,enabled:true,registeredAt:new Date().toISOString()});
const adapter:ProviderAdapter={provider:'test',async generate(m,r){return{modelId:m.id,output:{ok:true},usage:{contextUnits:1,outputUnits:1,costEstimate:.002,latencyMs:2},finishReason:'stop',provenance:{method:'model',producedBy:m.id,producedOn:'test',producedAt:new Date().toISOString(),correlationId:r.correlationId,derivedFromUntrusted:true}}},async health(m){return{modelId:m.id,provider:'test',status:'healthy',checkedAt:new Date().toISOString()}}};
describe('routing observability boundaries',()=>{
 it('reports actual attempt and fallback transitions before completion',async()=>{
  const registry=new ModelRegistry();const phases:string[]=[];
  registry.register(model('first','local'),{...adapter,async generate(){phases.push('provider:first');throw new Error('secret provider response')}});
  registry.register(model('second','local'),{...adapter,async generate(m,r,s){phases.push('provider:second');return adapter.generate(m,r,s)}});
  const response=await new ModelGateway(registry).generate(req(),undefined,async routing=>{phases.push(routing.phase!);expect(routing.correlationId).toBe('c')});
  expect(phases).toEqual(['CANDIDATE','STARTING','provider:first','FALLBACK','provider:second','COMPLETE']);
  expect(response.routing?.candidates[0]?.healthState).toBe('unknown');
  expect(response.usage.inputTokens).toBeUndefined();
 });
 it('propagates observation persistence failure without invoking a provider or changing its breaker',async()=>{
  const registry=new ModelRegistry();let calls=0;
  registry.register(model('one','local'),{...adapter,async generate(m,r,s){calls++;return adapter.generate(m,r,s)}});
  await expect(new ModelGateway(registry).generate(req(),undefined,async routing=>{if(routing.phase==='STARTING')throw new Error('database unavailable')})).rejects.toThrow('database unavailable');
  expect(calls).toBe(0);expect(registry.get('one')?.breaker.state).toBe('closed');
 });
 it('records terminal failure without exposing provider secrets',async()=>{
  const registry=new ModelRegistry();const observations:unknown[]=[];
  registry.register(model('one','local'),{...adapter,async generate(){throw new Error('secret=do-not-expose')}});
  await expect(new ModelGateway(registry).generate(req(),undefined,async routing=>{observations.push(routing)})).rejects.toThrow('model provider request failed');
  expect(observations.at(-1)).toMatchObject({phase:'FAILED',errorClass:'PROVIDER_ERROR'});
  expect(JSON.stringify(observations)).not.toContain('do-not-expose');
 });
});
describe('model gateway',()=>{it('routes sensitive content only to local models and explains rejection',async()=>{const r=new ModelRegistry();r.register(model('cloud','cloud-ok'),adapter);r.register(model('local','local'),adapter);const response=await new ModelGateway(r).generate(req({privacyClass:'SENSITIVE'}));expect(response.modelId).toBe('local');expect(response.routing?.candidates.find(candidate=>candidate.modelId==='cloud')).toMatchObject({state:'UNAVAILABLE',reason:'privacy/locality requires local execution'});expect(response.routing?.selectedModelId).toBe('local')});it('fails closed when no model meets locality',async()=>{const r=new ModelRegistry();r.register(model('cloud','cloud-ok'),adapter);await expect(new ModelGateway(r).generate(req({locality:'local'}))).rejects.toMatchObject({code:'NO_ROUTE'})});it('opens the circuit after repeated provider failure',async()=>{const bad:ProviderAdapter={...adapter,async generate(){throw new Error('down')}};const r=new ModelRegistry();r.register(model('bad','local'),bad);const g=new ModelGateway(r);for(let i=0;i<3;i++)await expect(g.generate(req())).rejects.toMatchObject({code:'PROVIDER_ERROR'});await expect(g.generate(req())).rejects.toMatchObject({code:'NO_ROUTE'})})});
