import { PgInvocationStore } from '../src/kernel/executor/invocation-store.ts';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { setupIt,type ItContext } from './it-harness.ts';
import { SystemTelemetry } from '../src/kernel/telemetry/system-telemetry.ts';
let ctx:ItContext;
describe('system telemetry authoritative projection',()=>{
 beforeAll(async()=>{ctx=await setupIt();},180000);
 afterAll(async()=>{await ctx?.cleanup();});
 it('reads real migrated state and exposes no credentials or source labels',async()=>{
   const telemetry=new SystemTelemetry({sql:ctx.pg.sql,redisPing:async()=>false});const snapshot=await telemetry.snapshot();
   expect(snapshot.readings.postgres?.value).toBe(1);expect(snapshot.readings.redis?.value).toBe(0);expect(snapshot.readings.postgresSize?.value).toBeGreaterThan(0);
   expect(snapshot.readings.queue?.value).toBe(0);expect(snapshot.readings.outbox?.value).toBe(0);expect(snapshot.readings.tokens?.value).toBeNull();expect(snapshot.readings.agencyPROPOSED?.value).toBe(0);
   expect(snapshot.history).toHaveLength(1);snapshot.readings.postgres!.value=999;expect((await telemetry.snapshot()).readings.postgres?.value).toBe(1);
   expect(JSON.stringify(snapshot)).not.toContain('postgresql://');
 });
 it('keeps absent traces null instead of inventing a trace from correlation',async()=>{const store=new PgInvocationStore(ctx.pg.sql);await store.create({invocationId:'telemetry-trace-absence',proposalId:'telemetry-proposal',capabilityId:'capabilities.test',capabilityVersion:'1',action:'inspect',state:'PROPOSED',correlationId:'correlation-is-not-a-trace',principalId:'p',originActor:{kind:'system',id:'test'},riskClass:'LOW',inputHash:'h',history:[]});const [row]=await ctx.pg.sql`select trace_id,correlation_id from agency.invocations where invocation_id='telemetry-trace-absence'`;expect(row?.trace_id).toBeNull();expect(row?.correlation_id).toBe('correlation-is-not-a-trace');expect((await store.byProposal('telemetry-proposal'))?.traceId).toBeUndefined();});
});
