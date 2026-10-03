import { describe,it,expect,vi } from 'vitest';
import { TelemetryReview } from './telemetry-review.ts';
import type { SystemTelemetrySnapshot } from '@jarvis/scene';
import { AgentRuntime } from '../cognition/agent-runtime.ts';
const sample=(n:number):SystemTelemetrySnapshot=>({generatedAt:new Date(n*1000).toISOString(),window:'24h',overallHealth:'healthy',history:[],readings:Object.fromEntries([['queue',n],['postgres',1],['redis',1]].map(([key,value])=>[key,{value,unit:'count',status:'available',observedAt:null}]))});
describe('Argus ambiguous telemetry review',()=>{
 it('uses local bounded reasoning only after sustained growth and returns diagnostic counts',async()=>{const invoke=vi.fn().mockResolvedValue({result:{proposals:[{kind:'answer'},{kind:'capability_invocation'}]}});const reviewer=new TelemetryReview();const deps={runtime:{invoke} as unknown as AgentRuntime,principalId:'p',correlationId:'c',localAvailable:true};for(let n=1;n<4;n++)expect(await reviewer.review(sample(n),deps)).toBeUndefined();expect(invoke).not.toHaveBeenCalled();expect(await reviewer.review(sample(4),deps)).toEqual({reviewed:true,proposalCount:1});expect(invoke.mock.calls[0]?.[0]).toBe('agents.argus');expect(invoke.mock.calls[0]?.[1]).toMatchObject({locality:'local',cloudAllowed:false,budget:{maxCost:.05,maxLatencyMs:10000}});await reviewer.review(sample(5),deps);expect(invoke).toHaveBeenCalledTimes(1);});
 it('does not use cloud when local reasoning is absent',async()=>{const invoke=vi.fn();const reviewer=new TelemetryReview();for(let n=1;n<8;n++)await reviewer.review(sample(n),{runtime:{invoke} as unknown as AgentRuntime,principalId:'p',correlationId:'c',localAvailable:false});expect(invoke).not.toHaveBeenCalled();});
});

it('passes its numeric context through the real isolated Agent Runtime budget gate',async()=>{
 const generate=vi.fn(async(request:import('@jarvis/contracts').ModelRequest)=>({modelId:'local-test',output:{proposals:[],evidence:[]},usage:{contextUnits:10,outputUnits:1,costEstimate:0,latencyMs:1},finishReason:'stop' as const,provenance:{method:'model' as const,producedBy:'local-test',producedOn:'test',producedAt:new Date().toISOString(),correlationId:request.correlationId,derivedFromUntrusted:true}}));
 const runtime=new AgentRuntime({generate},()=>new Date().toISOString());const reviewer=new TelemetryReview();let result;
 try{for(let n=1;n<=4;n++)result=await reviewer.review(sample(n),{runtime,principalId:'p',correlationId:'c',localAvailable:true});expect(result).toEqual({reviewed:true,proposalCount:0});expect(generate).toHaveBeenCalledTimes(1);expect(generate.mock.calls[0]?.[0].input.context).toMatchObject({budget:{limitUnits:4000},maxPrivacyClass:'INTERNAL'});}finally{await runtime.stop();}
});
