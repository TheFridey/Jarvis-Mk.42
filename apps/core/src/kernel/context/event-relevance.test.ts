import {expect,it} from 'vitest';
import {recentEventRelevant} from './event-relevance.ts';
it('keeps audio metadata for audio questions without polluting unrelated reasoning',()=>{
 expect(recentEventRelevant('jarvis.perception.audio.asr.transcript','What is two plus two?')).toBe(false);
 expect(recentEventRelevant('jarvis.perception.audio.asr.transcript','What did you hear me say?')).toBe(true);
 expect(recentEventRelevant('jarvis.atlas.fact.updated','What is two plus two?')).toBe(true);
 expect(recentEventRelevant('jarvis.perception.vision.screen','What is two plus two?')).toBe(true);
});
