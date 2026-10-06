import {expect,it,vi} from 'vitest';
import {startRtcSession} from './rtc-session.ts';
it.each(['connect','publish','startAudio'] as const)('stops a cancelled RTC session during %s without starting later media work',async stage=>{
  let release!:()=>void,current=true;
  const waiting=new Promise<void>(resolve=>{release=resolve});
  const connect=vi.fn(async()=>{}),publish=vi.fn(async()=>{}),startAudio=vi.fn(async()=>{}),discard=vi.fn(async()=>{});
  const steps={connect,publish,startAudio};steps[stage].mockImplementation(async()=>waiting);
  const result=startRtcSession({...steps,discard,isCurrent:()=>current});
  await vi.waitFor(()=>expect(steps[stage]).toHaveBeenCalledOnce());current=false;release();
  expect(await result).toBe(false);expect(discard).toHaveBeenCalledOnce();
  if(stage==='connect')expect(publish).not.toHaveBeenCalled();
  if(stage!=='startAudio')expect(startAudio).not.toHaveBeenCalled();
});
it('starts audio only after a current session has connected and published',async()=>{
  const order:string[]=[];
  expect(await startRtcSession({connect:async()=>{order.push('connect')},publish:async()=>{order.push('publish')},startAudio:async()=>{order.push('audio')},isCurrent:()=>true,discard:async()=>{order.push('discard')}})).toBe(true);
  expect(order).toEqual(['connect','publish','audio']);
});
