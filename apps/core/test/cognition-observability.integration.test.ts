import { afterAll, beforeAll, expect, it } from 'vitest';
import { ModelGatewayError, type ModelResponse, type ModelRoutingObservability } from '@jarvis/contracts';
import { setupIt, type ItContext } from './it-harness.ts';
let ctx: ItContext;
beforeAll(async()=>{ctx=await setupIt()});
afterAll(async()=>{await ctx?.cleanup()});
it('persists observed route attempts with correlation through the Kernel event boundary',async()=>{
 const kernel=ctx.makeKernel({modelGateway:{async generate(request,_signal,observe){
  const routing:ModelRoutingObservability={schemaVersion:1,phase:'STARTING',correlationId:request.correlationId,taskClass:request.task,privacyClass:request.privacyClass??'INTERNAL',startedAt:new Date().toISOString(),selectedModelId:'fixture-local',fallbackModelIds:[],candidates:[],selectionReason:'fixture route'};
  await observe?.(routing);
  const response:ModelResponse={modelId:'fixture-local',output:{proposals:[]},usage:{contextUnits:1,outputUnits:1,costEstimate:0,latencyMs:1},finishReason:'stop',provenance:{method:'model',producedBy:'fixture',producedOn:'test',producedAt:new Date().toISOString(),correlationId:request.correlationId,derivedFromUntrusted:true},routing:{...routing,phase:'COMPLETE'}};
  await observe?.(response.routing!);return response;
 }}});
 await kernel.start();
 await kernel.cognition.submit({requestId:'observed-route',principalId:'principal-operator',correlationId:'corr-observed-route',input:'Inspect route',agentId:'agents.oracle',task:'reason',objectiveId:'objective-reference'});
 const [row]=await ctx.pg.sql<Array<{routing_observability:ModelRoutingObservability;objective_ref:string;usage_observability:ModelResponse['usage']}>>`select routing_observability,objective_ref,usage_observability from cognition.runs where request_id='observed-route'`;
 expect(row?.routing_observability).toMatchObject({phase:'COMPLETE',correlationId:'corr-observed-route',selectedModelId:'fixture-local'});
 expect(row?.objective_ref).toBe('objective-reference');expect(row?.usage_observability.inputTokens).toBeUndefined();
 const events=await kernel.eventStore.byCorrelation('corr-observed-route');
 expect(events.filter(event=>event.type==='jarvis.cognition.model.selected').length).toBeGreaterThan(0);
 expect(events.every(event=>event.correlationId==='corr-observed-route')).toBe(true);
});
it('reports provider unavailability safely while canonical local telemetry remains usable',async()=>{
 let calls=0;
 const kernel=ctx.makeKernel({noHttp:false,modelGateway:{async generate(){calls++;throw new ModelGatewayError('UNAVAILABLE','fixture-private-error-canary',true);}}});
 await kernel.start();
 const auth=await fetch(`http://127.0.0.1:${kernel.diagnosticsPort}/auth/session`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({nodeId:kernel.config.nodeId,credential:kernel.config.bootstrapCredential,scopes:['desktop.read','desktop.write']})}).then(r=>r.json()) as {accessToken:string;credential:{sessionId:string}};
 const headers={'content-type':'application/json',authorization:'Bearer '+auth.accessToken,'x-jarvis-node-id':kernel.config.nodeId,'x-jarvis-session-id':auth.credential.sessionId};
 const submit=async(input:string,commandId:string)=>fetch(`http://127.0.0.1:${kernel.diagnosticsPort}/desktop/cognition`,{method:'POST',headers,body:JSON.stringify({commandId,expectedStateVersion:(await kernel.state.view()).stateVersion,input})});
 const failed=await submit('Reason about offline availability','offline-reason');
 expect(failed.status).toBe(503);
 const body=await failed.json() as {code:string;error:string};
 expect(body.code).toBe('UNAVAILABLE');expect(body.error).toContain('Model inference is unavailable');expect(JSON.stringify(body)).not.toContain('fixture-private-error-canary');
 const attempts=calls;const telemetry=await submit('Jarvis, check production.','offline-local-read');
 expect(telemetry.status).toBe(200);expect(calls).toBe(attempts);
 expect((await telemetry.json()) as {modelId:string}).toMatchObject({modelId:'sentinel:measured-telemetry'});
 const [run]=await ctx.pg.sql<Array<{status:string;error_code:string}>>`select status,error_code from cognition.runs where request_id='offline-reason'`;
 expect(run).toMatchObject({status:'failed',error_code:'UNAVAILABLE'});
});
