import { describe, expect, it } from 'vitest';
import { EventNames, type Event } from '@jarvis/contracts';
import { FakeClock } from '../../runtime/clock.ts';
import { OutboxRelay } from './outbox-relay.ts';
import { MemoryDeadLetterSink } from './stores.ts';

const event=(id:string,type:string):Event=>({id,type,schemaVersion:1,retentionClass:'OPERATIONAL',time:'2026-01-01T00:00:00.000Z',recordedAt:'2026-01-01T00:00:00.000Z',source:{node:'n',component:'test'},subject:{kind:'test',id},actor:{kind:'system',id:'test'},provenance:{method:'system',producedBy:'test',producedOn:'n',producedAt:'2026-01-01T00:00:00.000Z',correlationId:id,derivedFromUntrusted:false},causationId:'none',correlationId:id,principalId:'system',privacyClass:'INTERNAL',payload:{}});

describe('outbox dead-letter recursion',()=>{
  it('reaches a stable O(N) state when the bus is permanently unavailable',async()=>{
    const clock=new FakeClock(Date.parse('2026-01-01T00:00:00.000Z')), events=new Map<string,Event>(), rows:Array<{id:string,eventId:string,attempts:number,next:number,done:boolean}>=[];let seq=0;
    for(let i=0;i<4;i++){const e=event(`original-${i}`,EventNames.ModeChanged);events.set(e.id,e);rows.push({id:String(++seq),eventId:e.id,attempts:0,next:0,done:false})}
    const dlq=new MemoryDeadLetterSink();
    const relay=new OutboxRelay({store:{byId:async(id:string)=>events.get(id)} as never,outbox:{claimBatch:async(_limit:number,now:string)=>{const row=rows.find(r=>!r.done&&r.next<=Date.parse(now));if(!row)return[];row.attempts++;return[{id:row.id,eventId:row.eventId,attempts:row.attempts}]},markDispatched:async(id:string)=>{rows.find(r=>r.id===id)!.done=true},reschedule:async(id:string,next:string)=>{rows.find(r=>r.id===id)!.next=Date.parse(next)}} as never,bus:{isHealthy:()=>false,publish:async()=>{throw new Error('offline')}} as never,deadLetter:dlq,events:{emit:async(input:{type:string;causationId:string})=>{const e=event(`notice-${input.causationId}`,input.type);events.set(e.id,e);rows.push({id:String(++seq),eventId:e.id,attempts:0,next:clock.epochMs(),done:false});return e}} as never,clock,onHealth:()=>undefined},{pollMs:1,batchSize:10,maxAttempts:2,baseBackoffMs:1});
    for(let i=0;i<100;i++){await relay.drainOnce();clock.advance(10)}
    expect(rows).toHaveLength(8);
    expect([...events.values()].filter(e=>e.type===EventNames.EventDeadLettered)).toHaveLength(4);
    expect(dlq.entries).toHaveLength(8);
    expect(rows.every(r=>r.done)).toBe(true);
    for(let i=0;i<20;i++){await relay.drainOnce();clock.advance(10)}
    expect(rows).toHaveLength(8);
  });
  it('joins an in-flight relay pass before stop resolves',async()=>{const clock=new FakeClock(0),e=event('original',EventNames.ModeChanged);let claimed=false,marked=false,release!:()=>void;const publishing=new Promise<void>(resolve=>{release=resolve});const relay=new OutboxRelay({store:{byId:async()=>e}as never,outbox:{claimBatch:async()=>claimed?[]:(claimed=true,[{id:'1',eventId:e.id,attempts:1}]),markDispatched:async()=>{marked=true},reschedule:async()=>undefined}as never,bus:{isHealthy:()=>true,publish:async()=>publishing}as never,deadLetter:new MemoryDeadLetterSink(),events:{}as never,clock,onHealth:()=>undefined},{pollMs:100,batchSize:1,maxAttempts:2,baseBackoffMs:1});const tick=relay.tick();let stopped=false;const stop=relay.stop().then(()=>{stopped=true});await Promise.resolve();expect(stopped).toBe(false);release();await Promise.all([tick,stop]);expect(marked).toBe(true);expect(stopped).toBe(true)});
});
