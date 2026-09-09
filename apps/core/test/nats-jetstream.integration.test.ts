import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile as callback } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { connect } from 'nats';
import { EventNames, type Event } from '@jarvis/contracts';
import { MemoryDeadLetterSink, MemoryProcessedLedger } from '../src/kernel/event-fabric/stores.ts';
import { NatsEventBus } from '../src/kernel/event-fabric/nats-bus.ts';
import { STREAMS } from '../src/kernel/event-fabric/stream-topology.ts';
const execFile=promisify(callback);const name=`jarvis-it-nats-${Date.now()}-${process.pid}`;let url='';let bus:NatsEventBus|undefined;const transportHealth:boolean[]=[];
const freePort=()=>new Promise<number>((resolve,reject)=>{const server=createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const address=server.address();const port=typeof address==='object'&&address?address.port:0;server.close(error=>error?reject(error):resolve(port))})});
const makeEvent=(id:string,type:string,retentionClass:Event['retentionClass']):Event=>({id,type,schemaVersion:1,retentionClass,time:new Date().toISOString(),recordedAt:new Date().toISOString(),source:{node:'it',component:'test'},subject:{kind:'test',id},actor:{kind:'system',id:'test'},provenance:{method:'system',producedBy:'test',producedOn:'it',producedAt:new Date().toISOString(),correlationId:id,derivedFromUntrusted:false},causationId:'none',correlationId:id,principalId:'system',privacyClass:'INTERNAL',payload:{}});
async function waitForNats(){for(let i=0;i<40;i++){try{const nc=await connect({servers:url,timeout:500});await nc.close();return}catch{await new Promise(r=>setTimeout(r,250))}}throw new Error(`mandatory JetStream container ${name} did not become ready`)}

describe('real NATS JetStream topology',()=>{
  beforeAll(async()=>{const port=await freePort();url=`nats://127.0.0.1:${port}`;await execFile('docker',['run','-d','--name',name,'-p',`127.0.0.1:${port}:4222`,'nats:2.10-alpine','-js','-sd','/data']);await waitForNats()},120_000);
  afterAll(async()=>{await bus?.close().catch(()=>undefined);await execFile('docker',['rm','-f',name]).catch(()=>undefined)},60_000);
  it('creates non-overlapping streams, routes all classes, and deduplicates msgID',async()=>{
    bus=new NatsEventBus(url,new MemoryProcessedLedger(),new MemoryDeadLetterSink(),undefined,healthy=>{transportHealth.push(healthy)});await bus.start();
    const nc=await connect({servers:url}),jsm=await nc.jetstreamManager();
    for(const expected of STREAMS){const info=await jsm.streams.info(expected.name);expect([...info.config.subjects].sort()).toEqual([...expected.subjects].sort())}
    const received:string[]=[];await bus.subscribe({consumer:`it-${Date.now()}`,subjects:['jarvis.>'],handler:async e=>{received.push(e.id)}});
    const samples=[makeEvent('01J00000000000000000000001',EventNames.VoiceTranscript,'TRANSIENT'),makeEvent('01J00000000000000000000002',EventNames.IdentityRevoked,'SECURITY'),makeEvent('01J00000000000000000000003',EventNames.ModeChanged,'OPERATIONAL')];
    for(const sample of samples)await bus.publish(sample);await bus.publish(samples[1]!);
    for(let i=0;i<40&&received.length<3;i++)await new Promise(r=>setTimeout(r,50));
    expect(received.sort()).toEqual(samples.map(e=>e.id).sort());await nc.close();
  });
  it('reports disconnect, reconnects, and resumes unique delivery after NATS restarts',async()=>{
    expect(bus).toBeDefined();const received:string[]=[];await bus!.subscribe({consumer:`recovery-${Date.now()}`,subjects:[EventNames.ModeChanged],handler:async e=>{received.push(e.id)}});
    const before=makeEvent('01J00000000000000000000004',EventNames.ModeChanged,'OPERATIONAL');await bus!.publish(before);
    for(let i=0;i<40&&!received.includes(before.id);i++)await new Promise(r=>setTimeout(r,50));expect(received).toContain(before.id);
    await execFile('docker',['stop',name],{timeout:30_000});for(let i=0;i<40&&bus!.isHealthy();i++)await new Promise(r=>setTimeout(r,100));expect(bus!.isHealthy()).toBe(false);expect(transportHealth).toContain(false);
    await execFile('docker',['start',name],{timeout:30_000});await waitForNats();for(let i=0;i<300&&!bus!.isHealthy();i++)await new Promise(r=>setTimeout(r,100));expect(bus!.isHealthy()).toBe(true);expect(transportHealth.at(-1)).toBe(true);
    const after=makeEvent('01J00000000000000000000005',EventNames.ModeChanged,'OPERATIONAL');await bus!.publish(after);await bus!.publish(after);
    for(let i=0;i<40&&!received.includes(after.id);i++)await new Promise(r=>setTimeout(r,50));expect(received.filter(id=>id===after.id)).toHaveLength(1);
  });
});
