import {describe,it,expect,vi} from 'vitest';
import {NotificationManager} from './notification-manager.ts';
import {FakeClock} from '../../runtime/clock.ts';
import type {NotificationRequest} from '@jarvis/contracts';
import type {DeliverySurface} from './surface-routing.ts';
const req=(principalId:string,extra:Partial<NotificationRequest>={}):NotificationRequest=>({principalId,source:'fixture',severity:'critical',urgency:'immediate',title:'Alert for '+principalId,body:'Private body',dedupeKey:'same-key',correlationId:'fixture',...extra});
function manager(){let id=0;return new NotificationManager({clock:new FakeClock(0),ids:{ulid:()=>String(++id)},state:{getSlice:async()=>null,mutate:async()=>undefined} as never,events:{emit:async()=>undefined} as never,currentMode:async()=>'ENGAGED',currentPresence:async()=>'PRESENT'});}
describe('notification routing lifecycle',()=>{
  it('retries a queued alert on connection without deduplicating its own delivery',async()=>{
    const m=manager(),sink=vi.fn();let surfaces:DeliverySurface[]=[];m.setSurfaceProvider(async()=>surfaces);m.registerSink(sink);
    expect((await m.submit(req('owner'))).disposition).toBe('queued');expect(sink).not.toHaveBeenCalled();
    surfaces=[{id:'phone',principalId:'owner',kind:'mobile',trust:'owned-mobile',presence:'PRESENT',available:true}];await m.retryQueued();expect(sink).toHaveBeenCalledTimes(1);expect(sink.mock.calls[0]?.[0]).toMatchObject({disposition:'delivered',deliverySurfaceId:'phone'});await m.retryQueued();expect(sink).toHaveBeenCalledTimes(1);
  });
  it('never mixes principals in a digest and retains the strongest trust requirement',async()=>{
    const m=manager();const surfaces:DeliverySurface[]=[{id:'desktop',principalId:'owner',kind:'desktop',trust:'owned-secure',presence:'PRESENT',available:true}];m.setSurfaceProvider(async()=>surfaces);
    await m.submit(req('owner',{severity:'info',urgency:'normal',title:'owner private',minimumSurfaceTrust:'owned-secure'}));await m.submit(req('other',{severity:'info',urgency:'normal',title:'other private'}));
    const digest=await m.flushBatch();expect(digest?.request.body).toContain('owner private');expect(digest?.request.body).not.toContain('other private');expect(digest?.deliverySurfaceId).toBe('desktop');expect(digest?.request.minimumSurfaceTrust).toBe('owned-secure');expect(m.batchedCount).toBe(1);
  });
  it('does not let one principal suppress another principal through a shared dedupe key',async()=>{const m=manager();m.setSurfaceCount(1);expect((await m.submit(req('one'))).disposition).toBe('delivered');expect((await m.submit(req('two'))).disposition).toBe('delivered');expect((await m.submit(req('one'))).disposition).toBe('suppressed');});
});
