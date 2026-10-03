import {afterEach,describe,expect,it,vi} from 'vitest';
import {VoiceQualification} from './qualification.ts';
afterEach(()=>vi.useRealTimers());
describe('hardware evidence qualification',()=>{
 it('does not infer hardware proof from timings or missing checks',()=>{const q=new VoiceQualification('local');q.record({name:'interruption',latencyMs:2,observedAt:'now'});expect(q.report()).toMatchObject({hardwareVerified:false,operatorAttested:false,falseWakesPerHour:null});expect(JSON.stringify(q.report())).not.toContain('transcript');expect(()=>q.falseWake()).toThrow('baseline');});
 it('requires operator checks, repeated wake samples, baseline and no observed self-trigger',()=>{
  vi.useFakeTimers({toFake:['performance','Date']});const q=new VoiceQualification('windows');
  for(const name of ['wake','partial','reply','barge-in','same-context','self-trigger','device-recovery','input-switch','output-switch'])q.mark(name,'PASS');
  for(const name of ['wake','wake','wake','asr','interruption','response','device-recovery'] as const)q.record({name,latencyMs:10,observedAt:'now'});
  expect(q.report().hardwareVerified).toBe(false);q.baseline('start');vi.advanceTimersByTime(600001);q.baseline('stop');expect(q.report().hardwareVerified).toBe(true);
  q.selfTrigger();expect(q.report().hardwareVerified).toBe(false);
 });
});
