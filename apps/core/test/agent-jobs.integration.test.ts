import { afterAll, beforeAll, expect, it } from 'vitest';
import { AgentJobStore } from '../src/kernel/cognition/agent-job-store.ts';
import { AGENTS, AgentRuntime, agentJobIdentity } from '../src/kernel/cognition/agent-runtime.ts';
import { cognitionIdentity } from '../src/kernel/cognition/cognition-orchestrator.ts';
import { runAgentWorker } from '../src/kernel/cognition/agent-worker-host.ts';
import { createHash } from 'node:crypto';
import type { CognitionRequest, ModelRequest, ModelResponse } from '@jarvis/contracts';
import type { KernelHandle } from '../src/kernel/lifecycle/kernel.ts';
import { setupIt, type ItContext } from './it-harness.ts';
let ctx: ItContext;
let store: AgentJobStore;
let kernel: KernelHandle;
beforeAll(async () => { ctx = await setupIt(); kernel = ctx.makeKernel(); await kernel.start(); store = new AgentJobStore(ctx.pg.sql, kernel.events); });
afterAll(async () => { await ctx?.cleanup(); });
const job = (jobId: string, parentJobId?: string) => ({ jobId, parentJobId, agentId: 'agents.oracle', principalId: 'principal-operator', correlationId: 'agent-lease-test', task: 'reason', hash: jobId, wallMs: 120000, contextUnits: 100, costLimit: 1 });
it('recovers pre-inference leases with fencing and preserves history across store reconstruction', async () => {
  await store.enqueue(job('recover'));
  const lease = await store.claim('recover', 'dead-worker'); expect(lease?.attempt).toBe(1);
  await ctx.pg.sql`update cognition.agent_jobs set lease_expiry=clock_timestamp()-interval '1 second' where job_id='recover'`;
  const restarted = new AgentJobStore(ctx.pg.sql, ctx.makeKernel().events);
  await restarted.reap();
  const reclaimed = await restarted.claim('recover', 'new-worker'); expect(reclaimed?.attempt).toBe(2);
  await expect(store.heartbeat('recover', 'dead-worker', 1)).rejects.toThrow('lease lost');
  await restarted.update('recover', 'new-worker', 2, 'CANCELLED');
});
it('blocks unknown inference outcomes rather than blindly repeating model cost', async () => {
  await store.enqueue(job('unknown')); const lease = await store.claim('unknown', 'dead-worker');
  await store.update('unknown', 'dead-worker', lease!.attempt, 'WAITING');
  await ctx.pg.sql`update cognition.agent_jobs set lease_expiry=clock_timestamp()-interval '1 second' where job_id='unknown'`;
  await store.reap();
  const [row] = await ctx.pg.sql`select state,error_code from cognition.agent_jobs where job_id='unknown'`;
  expect(row).toMatchObject({ state: 'BLOCKED', error_code: 'INFERENCE_OUTCOME_UNKNOWN' });
  expect(await store.claim('unknown', 'new-worker')).toBeUndefined();
});
it('bounds child creation and rejects cross-principal relationships', async () => {
  await store.enqueue(job('parent'));
  for (let n = 0; n < 4; n++) await store.enqueue(job(`child-${n}`, 'parent'));
  await expect(store.enqueue(job('child-overflow', 'parent'))).rejects.toThrow('fan-out');
  await expect(store.enqueue({ ...job('wrong-principal', 'parent'), principalId: 'other' })).rejects.toThrow('binding mismatch');
});
it('persists terminal wall budget exhaustion and the canonical event/outbox atomically', async () => {
  await store.enqueue(job('deadline'));
  await ctx.pg.sql`update cognition.agent_jobs set deadline=clock_timestamp()-interval '1 second' where job_id='deadline'`;
  await store.reap();
  const [row] = await ctx.pg.sql`select state,error_code from cognition.agent_jobs where job_id='deadline'`;
  expect(row).toMatchObject({ state: 'FAILED', error_code: 'WALL_BUDGET_EXCEEDED' });
  const [events] = await ctx.pg.sql`select count(*)::int as count from events.events where type='jarvis.cognition.agent.job.transitioned' and subject_id='deadline'`;
  expect(events?.count).toBe(2);
  const [outbox]=await ctx.pg.sql`select count(*)::int as count from events.events e join events.outbox o on o.event_id=e.id where e.type='jarvis.cognition.agent.job.transitioned' and e.subject_id='deadline'`;
  expect(outbox?.count).toBe(2);
});
const modelRequest = (instruction:string):ModelRequest => ({task:'reason',capabilities:['json'],input:{instruction,context:{} as never,constraints:[]},budget:{contextUnits:10,maxOutput:10},locality:'local',principalId:'principal-operator',correlationId:'agent-lease-test'});
const modelResponse = (correlationId:string):ModelResponse => ({modelId:'fixture',output:{proposals:[]},usage:{contextUnits:1,outputUnits:1,costEstimate:0,latencyMs:1},finishReason:'stop',provenance:{method:'model',producedBy:'fixture',producedOn:'test',producedAt:new Date().toISOString(),correlationId,derivedFromUntrusted:true}});
it('retains authoritative history after killing a real worker before inference',async()=>{
  await store.enqueue(job('killed-worker'));const lease=await store.claim('killed-worker','owned-worker');let calls=0;
  await expect(runAgentWorker({jobId:'killed-worker',request:modelRequest('kill'),signal:AbortSignal.timeout(10000),heartbeat:async()=>{},beforeInference:async()=>{},
    onSpawn:async pid=>{await store.heartbeat('killed-worker','owned-worker',lease!.attempt,pid);process.kill(pid,'SIGKILL')},gateway:{async generate(request){calls++;return modelResponse(request.correlationId)}}})).rejects.toThrow();
  expect((await store.get('killed-worker'))?.state).toBe('LEASED');expect(calls).toBe(0);
  await ctx.pg.sql`update cognition.agent_jobs set lease_expiry=clock_timestamp()-interval '1 second' where job_id='killed-worker'`;await store.reap();expect((await store.get('killed-worker'))?.state).toBe('QUEUED');
});
it('drains a five-job queue without exceeding four concurrent leased workers',async()=>{
  let entered=0, running=0, maxRunning=0;
  let fourEntered!:()=>void, fiveEntered!:()=>void, allQueued!:()=>void;
  const four=new Promise<void>(resolve=>{fourEntered=resolve});const five=new Promise<void>(resolve=>{fiveEntered=resolve});const queued=new Promise<void>(resolve=>{allQueued=resolve});
  const release:Array<()=>void>=[];
  let queuedCount=0;
  const off=kernel.events.onAppended(event=>{const payload=event.payload as {jobId?:string;state?:string};if(event.type==='jarvis.cognition.agent.job.transitioned'&&payload.jobId?.startsWith('queue-worker-')&&payload.state==='QUEUED'&&++queuedCount===5)allQueued()});
  const runtime=new AgentRuntime({generate:async request=>{
    entered++;running++;maxRunning=Math.max(maxRunning,running);
    if(entered===4)fourEntered();if(entered===5)fiveEntered();
    await new Promise<void>(resolve=>{release.push(resolve)});running--;return modelResponse(request.correlationId);
  }},()=>new Date().toISOString(),store);
  const pending=Array.from({length:5},(_,n)=>runtime.invoke('agents.oracle',modelRequest(`queue-${n}`),undefined,{jobId:`queue-worker-${n}`}));
  try{
    await Promise.all([four,queued]);
    const [counts]=await ctx.pg.sql`select count(*) filter(where state='QUEUED')::int as queued,count(*) filter(where state in ('LEASED','RUNNING','WAITING'))::int as active from cognition.agent_jobs where job_id like 'queue-worker-%'`;
    expect(counts).toMatchObject({queued:1,active:4});release.shift()!();await five;for(const resolve of release)resolve();
    await Promise.all(pending);expect(maxRunning).toBe(4);
  }finally{off();for(const resolve of release)resolve();await runtime.stop();await Promise.allSettled(pending)}
});
it('cancels queued work durably without inference and rejects another principal',async()=>{
  for(let n=0;n<4;n++){await store.enqueue(job(`cancel-slot-${n}`));await store.claim(`cancel-slot-${n}`,'reserved')}
  let calls=0, queued!:()=>void;
  const ready=new Promise<void>(resolve=>{queued=resolve});
  const off=kernel.events.onAppended(event=>{if(event.subject.id==='cancel-queued'&&(event.payload as {state:string}).state==='QUEUED')queued()});
  const runtime=new AgentRuntime({async generate(request){calls++;return modelResponse(request.correlationId)}},()=>new Date().toISOString(),store);
  const pending=runtime.invoke('agents.oracle',modelRequest('cancel'),undefined,{jobId:'cancel-queued'});
  const rejected=expect(pending).rejects.toThrow();
  try{
    await ready;await expect(runtime.cancelForPrincipal('cancel-queued','other')).rejects.toThrow('principal');
    expect(await runtime.cancelForPrincipal('cancel-queued','principal-operator')).toBe(true);await rejected;
    expect((await store.get('cancel-queued'))?.state).toBe('CANCELLED');expect(calls).toBe(0);
    expect(await runtime.cancelForPrincipal('cancel-queued','principal-operator')).toBe(true);
  }finally{off();await runtime.stop();for(let n=0;n<4;n++)await store.cancel(`cancel-slot-${n}`,'principal-operator')}
});
it('reclaims pre-inference history after a real Kernel restart and returns duplicate results without re-inference',async()=>{
  const req:CognitionRequest={requestId:'restart-job',principalId:'principal-operator',correlationId:'restart-correlation',agentId:'agents.oracle',task:'reason',input:'Recover this bounded request'};
  const identityHash=cognitionIdentity(req,kernel.config.modelCloudAllowed);
  await store.enqueue({...job(req.requestId),correlationId:req.correlationId,contextUnits:4000,costLimit:50,hash:agentJobIdentity(modelRequest(req.input),AGENTS['agents.oracle']!,identityHash)});
  await store.claim(req.requestId,'dead-parent');
  await ctx.pg.sql`insert into cognition.runs(request_id,principal_id,correlation_id,agent_id,status,input_hash,task_class,created_at) values(${req.requestId},${req.principalId},${req.correlationId},${req.agentId},'running',${createHash('sha256').update(req.input).digest('hex')},'reason',clock_timestamp())`;
  await ctx.pg.sql`update cognition.agent_jobs set lease_expiry=clock_timestamp()-interval '1 second' where job_id=${req.requestId}`;
  await kernel.stop();let calls=0;
  const recovered=ctx.makeKernel({modelGateway:{async generate(request){calls++;return modelResponse(request.correlationId)}}});await recovered.start();
  const result=await recovered.cognition.submit(req);expect(result.result.jobId).toBe(req.requestId);expect((await store.get(req.requestId))?.attempt).toBe(2);
  await recovered.stop();
  const restarted=ctx.makeKernel({modelGateway:{async generate(){throw new Error('duplicate must not re-infer')}}});await restarted.start();
  expect(await restarted.cognition.submit(req)).toEqual(result);expect(calls).toBe(1);expect((await store.get(req.requestId))?.state).toBe('COMPLETE');
});
