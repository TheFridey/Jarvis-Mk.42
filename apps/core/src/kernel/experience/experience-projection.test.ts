import { describe, expect, it, vi } from 'vitest';
import { channelsForEvent, ExperienceProjection, filterExperienceUpdate } from './experience-projection.ts';
import type { JarvisOperatingPicture } from '@jarvis/scene';
const picture=(version=1)=>({generatedAt:new Date().toISOString(),stateVersion:version,sceneVersion:version,scene:{version}} as JarvisOperatingPicture);
describe('ExperienceProjection',()=>{it('coalesces invalidations and maintains bounded resumable history',async()=>{let version=1;const p=new ExperienceProjection({streamId:'s',build:async()=>picture(version++),historySize:2});const seen=vi.fn();p.subscribe(seen);await p.snapshot();p.invalidate(['system']);p.invalidate(['scene']);await vi.waitFor(()=>expect(seen).toHaveBeenCalledTimes(2));expect(seen.mock.calls[1]?.[0].channels).toEqual(expect.arrayContaining(['system','scene']));p.invalidate(['agency']);await vi.waitFor(()=>expect(seen).toHaveBeenCalledTimes(3));expect(p.updatesAfter('s',0)).toBeUndefined();expect(p.updatesAfter('s',2)).toHaveLength(1);p.stop()})});

describe('Experience projection filtering',()=>{
  it('maps canonical activity to the minimum relevant channels',()=>{
    expect(channelsForEvent('jarvis.cognition.run.started')).toEqual(['cognition','system']);
    expect(channelsForEvent('jarvis.agency.invocation.completed')).toEqual(['agency','system']);
    expect(channelsForEvent('jarvis.kernel.health.transitioned')).toEqual(['system','scene','telemetry']);
  });
  it('removes unsubscribed fields from a realtime update',()=>{
    const update={type:'experience.update',schemaVersion:1,streamId:'s',sequence:1,generatedAt:'2026-09-29T00:00:00Z',stateVersion:1,sceneVersion:1,channels:['system','scene'],full:false,patch:{systemMode:'AMBIENT',scene:{version:1}}} as const;
    const filtered=filterExperienceUpdate(update as never,['scene']);
    expect(filtered?.channels).toEqual(['scene']);
    expect(filtered?.patch).toEqual({scene:{version:1}});
  });
});
