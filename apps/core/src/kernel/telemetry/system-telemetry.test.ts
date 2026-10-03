import { describe,it,expect } from 'vitest';
import { parsePrometheusReading } from './system-telemetry.ts';
const now=Date.now();const body=(samples:unknown[])=>({status:'success',data:{resultType:'vector',result:samples}});
describe('controlled telemetry projection',()=>{
 it('accepts a single fresh finite sample and drops labels',()=>{const result=parsePrometheusReading(body([{metric:{secret:'forbidden'},value:[now/1000,'42']}]),'%',now);expect(result.value).toBe(42);expect(JSON.stringify(result)).not.toContain('secret');});
 it('rejects ambiguous series, NaN, errors, old samples and future timestamps',()=>{for(const data of [body([]),body([{value:[now/1000,'NaN']}]),body([{value:[now/1000,'1']},{value:[now/1000,'2']}]),{status:'error'}])expect(parsePrometheusReading(data,'%',now).value).toBeNull();expect(parsePrometheusReading(body([{value:[(now-61000)/1000,'42']}]),'%',now).status).toBe('stale');expect(parsePrometheusReading(body([{value:[(now+10000)/1000,'42']}]),'%',now).value).toBeNull();});
});
