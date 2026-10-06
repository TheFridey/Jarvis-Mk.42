import {describe,it,expect,vi} from 'vitest';
import { CompanionService,companionPicture,nextMeetingTime } from './companion-service.ts';
import { companionDescriptor,companionScopes,type RegisteredNode } from '@jarvis/contracts';
import type { DesktopKernelSnapshot } from '@jarvis/scene';
const node={principalId:'owner',nodeType:'display',trustTier:'owned-mobile'} as RegisteredNode;
it.each([[false,false],[true,false],[false,true]])('isolates desktop public-site work while preserving private inputs (mobile=%s, recovered=%s)',async (mobile,recovered)=>{
  const input='Can you check the live ScaleSmiths site for me and audit where we are at? https://scalesmiths.co.uk';
  const turn={turn_id:'audit',conversation_id:'conversation',principal_id:'owner',source_node_id:'local-server',cognition_input:recovered?JSON.stringify({conversation:[{user:'private financial history'}],user:input}):null};
  const results=[[],[{principal_id:'owner'}],[],[turn],[{input:'private financial history',answer:'secret figures'}],...(!recovered?[[]]:[]),[]];
  const sql=vi.fn(async()=>results.shift()??[]);
  const cognize=vi.fn(async()=>({answer:'answer',result:{proposals:[]}}));
  const service=new CompanionService({sql,snapshot:async()=>({principalId:'owner',stateVersion:1}),cognize,now:()=> '2026-10-06T09:08:53Z',id:()=> 'new-conversation',invalidate:()=>{}} as unknown as ConstructorParameters<typeof CompanionService>[0]);
  await service.converse({nodeId:'local-server',principalId:'owner'},{commandId:'audit',expectedStateVersion:1,input},'conversation',mobile);
  const request=cognize.mock.calls[0] as unknown as [import('@jarvis/contracts').CognitionRequest];
  if(mobile||recovered){expect(request[0]).toMatchObject({locality:'local',cloudAllowed:false,...(mobile?{analysisOnly:true}:{})});expect(request[0].contextScope).toBeUndefined();expect(request[0].input).toContain('private financial history');}
  else{expect(request[0]).toMatchObject({input,contextScope:'public-web',locality:'prefer-local'});expect(request[0].input).not.toContain('private financial history');expect(request[0].cloudAllowed).toBeUndefined();}
});
describe('companion authority and privacy boundary',()=>{
  it('shows the next verified meeting time without exporting meeting titles or stale evidence',()=>{
    const p={generatedAt:'2026-10-03T09:00:00Z',scalesmiths:{readings:{meetings:{status:'available',value:[{summary:'private',start:{dateTime:'2026-10-03T08:00:00Z'}},{summary:'secret',start:{dateTime:'2026-10-03T10:00:00Z'}},{status:'cancelled',start:{dateTime:'2026-10-03T09:30:00Z'}}]}}}} as unknown as DesktopKernelSnapshot;
    expect(nextMeetingTime(p)).toBe('2026-10-03T10:00:00.000Z');p.scalesmiths!.readings.meetings!.status='stale';expect(nextMeetingTime(p)).toBeNull();
  });
  it('registers mobile below workstation authority and keeps wall read-only',()=>{
    expect(companionDescriptor('mobile-one','mobile')).toMatchObject({requestedTrustTier:'owned-mobile',sensors:[],capabilities:[]});
    expect(companionScopes(node)).toEqual(['companion.read']);
    expect(companionScopes({...node,nodeType:'mobile'})).toEqual(['companion.read','companion.converse','companion.present']);
    expect(companionScopes({...node,trustTier:'guest'})).toEqual([]);
  });
  it('projects only explicit status fields, never approvals, private business values, transcripts or raw state',()=>{
    const p={principalId:'owner',generatedAt:'now',stateVersion:2,sceneVersion:3,systemMode:'AMBIENT',interactionState:'AWARE',workState:'IDLE',systemHealth:{overall:'HEALTHY'},notifications:['alert'],activeCapabilities:[],agentJobs:[{agentId:'oracle',state:'RUNNING',activityConfirmed:false}],scalesmiths:{readings:{MRR:{status:'available',value:'private-money'},meetings:{status:'available',value:[{summary:'private-meeting'}]}}},approvals:[{nonce:'secret-nonce'}],state:{secret:'secret-state'},cognitionResponses:[{answer:'private-answer'}]} as unknown as DesktopKernelSnapshot;
    const result=companionPicture(p,node);
    expect(result.agents[0]?.state).toBe('UNCONFIRMED');expect(result.business[0]).toEqual({name:'MRR',status:'available'});
    expect(JSON.stringify(result)).not.toMatch(/private-money|private-meeting|secret-nonce|secret-state|private-answer/);
    expect(()=>companionPicture({...p,principalId:'other'},node)).toThrow('principal mismatch');
  });
});
