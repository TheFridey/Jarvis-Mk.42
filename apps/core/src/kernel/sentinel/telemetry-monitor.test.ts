import { describe,it,expect } from 'vitest';
import { TelemetryMonitor } from './telemetry-monitor.ts';
import type { SystemTelemetrySnapshot } from '@jarvis/scene';
const snapshot=(at:number,value:number|null,status:'available'|'unavailable'|'stale'='available'):SystemTelemetrySnapshot=>({generatedAt:new Date(at*1000).toISOString(),window:'24h',overallHealth:'unknown',history:[],readings:{cpu:{value,unit:'%',status,observedAt:null}}});
describe('deterministic telemetry monitors',()=>{
 it('requires sustained fresh evidence, deduplicates cached samples, resets after recovery',()=>{const monitor=new TelemetryMonitor();expect(monitor.evaluate(snapshot(1,99))).toEqual([]);expect(monitor.evaluate(snapshot(1,99))).toEqual([]);expect(monitor.evaluate(snapshot(2,99))).toEqual([]);expect(monitor.evaluate(snapshot(3,99))).toHaveLength(1);expect(monitor.evaluate(snapshot(4,99))).toEqual([]);expect(monitor.evaluate(snapshot(5,40))).toEqual([]);expect(monitor.evaluate(snapshot(6,99))).toEqual([]);});
 it('never treats absent GPU or stale data as an incident',()=>{const monitor=new TelemetryMonitor();for(let n=1;n<8;n++)expect(monitor.evaluate(snapshot(n,99,'stale'))).toEqual([]);});
});

it('surfaces unexplained queue growth even before a reasoning model is available',()=>{const monitor=new TelemetryMonitor();let findings;for(let n=1;n<=4;n++){const sample=snapshot(n,10);for(const[key,value]of [['queue',n],['postgres',1],['redis',1]] as const)sample.readings[key]={value,unit:'count',status:'available',observedAt:sample.generatedAt};findings=monitor.evaluate(sample);}expect(findings).toEqual([expect.objectContaining({key:'telemetry.queue.growth',reasoningRequired:true})]);});
