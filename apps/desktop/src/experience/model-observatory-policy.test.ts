import { expect, it } from 'vitest';
import type { OperatingModelRun } from '@jarvis/scene';
import { liveActivityPicture, modelRunState } from './model-observatory-policy.ts';
it('withholds stale activity from Core motion and sound consumers',()=>{
 const picture={workState:'THINKING'} as never;
 expect(liveActivityPicture(picture,false)).toBeUndefined();
 expect(liveActivityPicture(picture,true)).toBe(picture);
});
it('never describes disconnected activity as live',()=>{
 const run={status:'running',routing:{phase:'STARTING'}} as OperatingModelRun;
 expect(modelRunState(run,false)).toBe('STALE');expect(modelRunState(run,true)).toBe('STARTING');
});
it('does not infer streaming from selection or fallback',()=>{
 expect(modelRunState({status:'running'} as OperatingModelRun,true)).toBe('IDLE');
 expect(modelRunState({status:'running',routing:{phase:'FALLBACK'}} as OperatingModelRun,true)).toBe('FALLBACK');
 expect(modelRunState({status:'completed',routing:{phase:'STARTING'}} as OperatingModelRun,true)).toBe('COMPLETE');
});
it('does not describe a persisted run with an unconfirmed worker lease as active',()=>{
 expect(modelRunState({status:'running',activityConfirmed:false,routing:{phase:'STARTING'}} as OperatingModelRun,true)).toBe('WAITING / UNCONFIRMED');
 expect(modelRunState({status:'running',activityConfirmed:false,routing:{phase:'COMPLETE'}} as OperatingModelRun,true)).toBe('COMPLETE');
});
