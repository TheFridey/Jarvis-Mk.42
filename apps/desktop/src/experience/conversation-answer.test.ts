import {expect,it} from 'vitest';
import type {CognitionResponse} from '@jarvis/contracts';
import {latestConversationAnswer} from './conversation-answer.ts';
const response=(id:string,createdAt:string,finishedAt:string,answer:string)=>({requestId:id,createdAt,answer,result:{finishedAt}} as CognitionResponse);
it('selects the latest completed answer regardless of projection order or long inference',()=>{
  const earlier=response('ack','2026-10-06T09:00:00Z','2026-10-06T09:00:10Z','Awaiting approval');
  const audit=response('audit','2026-10-06T09:01:00Z','2026-10-06T09:02:12Z','Full completed audit');
  const fast=response('other','2026-10-06T09:01:50Z','2026-10-06T09:02:00Z','Another answer');
  expect(latestConversationAnswer([audit,fast,earlier])).toBe(audit);
  expect(latestConversationAnswer([earlier,fast,audit])).toBe(audit);
});
it('ignores responses without an answer',()=>{
  expect(latestConversationAnswer([response('empty','2026-10-06T09:03:00Z','2026-10-06T09:03:30Z','')])).toBeUndefined();
});
