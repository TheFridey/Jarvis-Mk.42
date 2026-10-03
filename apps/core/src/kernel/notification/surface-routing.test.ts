import { describe,it,expect } from 'vitest';
import { chooseDeliverySurface,type DeliverySurface } from './surface-routing.ts';
import type { NotificationRequest } from '@jarvis/contracts';
const request:NotificationRequest={principalId:'owner',source:'test',severity:'warning',urgency:'urgent',title:'Alert',body:'Body',dedupeKey:'one',correlationId:'one'};
const surface=(kind:DeliverySurface['kind'],extra:Partial<DeliverySurface>={}):DeliverySurface=>({id:kind,principalId:'owner',kind,trust:kind==='desktop'?'owned-secure':'owned-mobile',available:true,presence:'UNKNOWN',...extra});
describe('notification delivery surfaces',()=>{
  it('selects a personal mobile surface when away, wall while present and ambient, desktop while focused',()=>{
    const surfaces=[surface('wall'),surface('desktop'),surface('mobile')];
    expect(chooseDeliverySurface(request,surfaces,'AMBIENT','ABSENT')?.kind).toBe('mobile');
    expect(chooseDeliverySurface({...request,urgency:'normal'},surfaces,'AMBIENT','PRESENT')?.kind).toBe('wall');
    expect(chooseDeliverySurface(request,surfaces,'FOCUSED','FOCUSED')?.kind).toBe('desktop');
  });
  it('fails closed on privacy trust, wrong principal, and disconnected devices',()=>{
    expect(chooseDeliverySurface({...request,minimumSurfaceTrust:'owned-secure'},[surface('mobile'),surface('wall')],'ENGAGED','PRESENT')).toBeUndefined();
    expect(chooseDeliverySurface(request,[surface('desktop',{principalId:'other'}),surface('mobile',{available:false})],'ENGAGED','PRESENT')).toBeUndefined();
  });
  it('prefers evidence of active interaction over an ambient wall',()=>{
    expect(chooseDeliverySurface(request,[surface('wall'),surface('mobile',{presence:'ENGAGED'})],'AMBIENT','PRESENT')?.kind).toBe('mobile');
  });
});
