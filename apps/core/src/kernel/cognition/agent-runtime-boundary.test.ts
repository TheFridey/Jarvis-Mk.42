import { expect, it, vi } from 'vitest';
import { AGENTS, AgentRuntime } from './agent-runtime.ts';
import type { ModelRequest } from '@jarvis/contracts';
const request: ModelRequest = { task:'reason',capabilities:['json'],input:{instruction:'test',context:{} as never,constraints:[]},budget:{contextUnits:10,maxOutput:10},locality:'local',principalId:'p',correlationId:'c' };
const proposal = () => ({ proposalId:'p1',kind:'answer',correlationId:'c',confidence:1,text:'answer',citations:[],provenance:{method:'model',producedBy:'fixture',producedOn:'test',producedAt:new Date().toISOString(),correlationId:'c',derivedFromUntrusted:true} });
const runtime = (output: unknown) => new AgentRuntime({ async generate() { return { modelId:'fixture',output,usage:{contextUnits:1,outputUnits:1,costEstimate:0,latencyMs:1},finishReason:'stop',provenance:proposal().provenance as never }; } },()=>new Date().toISOString());
it('retains the eleven specialists and adds Nova without write authority',()=>{ expect(Object.keys(AGENTS)).toHaveLength(12); expect(AGENTS['agents.hephaestus']?.displayName).toBe('Hephaestus');expect(AGENTS['agents.nova']?.proposalScope.capabilities).toEqual([]); });
it('rejects a forged proposal correlation',async()=>{await expect(runtime({proposals:[{...proposal(),correlationId:'other'}]}).invoke('agents.oracle',request)).rejects.toThrow('correlation mismatch');});
it('rejects duplicate proposal identities',async()=>{await expect(runtime({proposals:[proposal(),proposal()]}).invoke('agents.oracle',request)).rejects.toThrow('duplicate proposal');});
it('rejects invalid evidence rather than silently losing it',async()=>{await expect(runtime({proposals:[proposal()],evidence:[42]}).invoke('agents.oracle',request)).rejects.toThrow();});
it('seals local proposal IDs per job and does not accept model claims of trusted provenance',async()=>{
  const value={...proposal(),provenance:{...proposal().provenance,method:'system',producedBy:'kernel',derivedFromUntrusted:false}};
  const first=await runtime({proposals:[value]}).invoke('agents.oracle',request,undefined,{jobId:'identity-one'});
  const second=await runtime({proposals:[value]}).invoke('agents.oracle',request,undefined,{jobId:'identity-two'});
  expect(first.result.proposals[0]?.proposalId).not.toBe(second.result.proposals[0]?.proposalId);
  expect(first.result.proposals[0]?.provenance).toMatchObject({method:'model',producedBy:'agents.oracle',derivedFromUntrusted:true});
});
it('rejects context overflow before spawning and leaves caller budget unchanged',async()=>{
  const input={...request,budget:{...request.budget,contextUnits:200001}};
  await expect(runtime({proposals:[]}).invoke('agents.oracle',input)).rejects.toThrow('context budget exceeded');expect(input.budget.contextUnits).toBe(200001);
});
it('retains context taint even when both adapter and model claim trusted output',async()=>{
  const value={...proposal(),provenance:{...proposal().provenance,derivedFromUntrusted:false}};
  const worker=new AgentRuntime({async generate(){return{modelId:'fixture',output:{proposals:[value]},usage:{contextUnits:1,outputUnits:1,costEstimate:0,latencyMs:1},finishReason:'stop',provenance:value.provenance as never}}},()=>new Date().toISOString());
  const result=await worker.invoke('agents.oracle',{...request,input:{...request.input,context:{items:[{provenance:{derivedFromUntrusted:true}}]} as never}});
  expect(result.result.proposals[0]?.provenance.derivedFromUntrusted).toBe(true);
});
it('enforces the declared cost ceiling rather than accepting excessive observed usage',async()=>{
  const worker=new AgentRuntime({async generate(){return{modelId:'fixture',output:{proposals:[]},usage:{contextUnits:1,outputUnits:1,costEstimate:2,latencyMs:1},finishReason:'stop',provenance:proposal().provenance as never}}},()=>new Date().toISOString());
  await expect(worker.invoke('agents.oracle',{...request,budget:{...request.budget,maxCost:1}})).rejects.toThrow('cost budget exceeded');
});
it('aborts mediated inference at the wall budget without using sleep-based test synchronisation',async()=>{
  vi.useFakeTimers();let entered!:()=>void,aborted=false;
  const ready=new Promise<void>(resolve=>{entered=resolve});
  const worker=new AgentRuntime({generate(_request,signal){entered();return new Promise((_resolve,reject)=>{signal!.addEventListener('abort',()=>{aborted=true;reject(new Error('aborted'))},{once:true})})}},()=>new Date().toISOString());
  const pending=worker.invoke('agents.oracle',{...request,budget:{...request.budget,maxLatencyMs:1000}});
  const rejected=expect(pending).rejects.toThrow('timed out');
  try{await ready;vi.advanceTimersByTime(1000);await rejected;expect(aborted).toBe(true)}finally{await worker.stop();vi.useRealTimers()}
});
