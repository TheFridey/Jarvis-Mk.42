import{describe,expect,it}from'vitest';import{FakeClock}from'../../runtime/clock.ts';import{HealthManager}from'./health-manager.ts';
describe('HealthManager listener ordering',()=>{it('does not resolve heartbeat when reconciliation fails',async()=>{const health=new HealthManager({state:{mutate:async()=>({ok:true})}as never,events:{emit:async()=>({})}as never,clock:new FakeClock(0),ids:{ulid:()=> '01J00000000000000000000000'}as never});health.register({subsystem:'critical',critical:true});health.onChange(async()=>{throw new Error('mode reconciliation failed')});await expect(health.heartbeat({subsystem:'critical',status:'HEALTHY'})).rejects.toThrow('mode reconciliation failed');expect(health.report().subsystems[0]?.status).toBe('HEALTHY')})});

describe('HealthManager transition semantics',()=>{
  const build=()=>{const emitted:string[]=[];const notified:string[]=[];const health=new HealthManager({state:{mutate:async()=>({ok:true})}as never,events:{emit:async(i:{type:string})=>{emitted.push(i.type);return{}}}as never,clock:new FakeClock(0),ids:{ulid:()=>'01J00000000000000000000000'}as never});health.onChange(async(r)=>{notified.push(r.overall)});return{health,emitted,notified}};

  it('does not emit a transition, or notify listeners, for a same-status heartbeat',async()=>{
    // Regression: the outbox relay heartbeats DEGRADED once per dead-lettered
    // event. When a differing *message* counted as a transition, each of those
    // emitted a durable HealthTransitioned event which itself dead-lettered -
    // an unbounded durable-event loop under a permanent NATS outage.
    const{health,emitted,notified}=build();
    health.register({subsystem:'event-fabric',critical:true});
    await health.heartbeat({subsystem:'event-fabric',status:'DEGRADED',message:'dead-lettered a'});
    expect(emitted).toHaveLength(1);
    for(const id of ['b','c','d','e'])await health.heartbeat({subsystem:'event-fabric',status:'DEGRADED',message:`dead-lettered ${id}`});
    expect(emitted).toHaveLength(1);
    // Listeners still run every time so a dwell-blocked recovery can retry.
    expect(notified).toHaveLength(5);
    // The latest message is still recorded for diagnostics.
    expect(health.report().subsystems[0]?.message).toBe('dead-lettered e');
  });

  it('still emits when the status genuinely changes',async()=>{
    const{health,emitted,notified}=build();
    health.register({subsystem:'event-fabric',critical:true});
    await health.heartbeat({subsystem:'event-fabric',status:'DEGRADED',message:'down'});
    await health.heartbeat({subsystem:'event-fabric',status:'DEGRADED',message:'still down'});
    await health.heartbeat({subsystem:'event-fabric',status:'HEALTHY',message:'up'});
    expect(emitted).toHaveLength(2);
    expect(notified).toEqual(['DEGRADED','DEGRADED','HEALTHY']);
  });
});
