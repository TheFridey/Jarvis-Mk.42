import { describe, expect, it, vi } from 'vitest';
import type { AdapterJob } from '../../../../adapter-host/src/ipc.ts';
import type { CredentialBroker } from '../credential-broker/broker.ts';
import { IntegrationTransport, scalePageSchema } from './transport.ts';
import { BusinessIntelligence } from './intelligence.ts';
import email from '../../../../../capabilities/email/definition.ts';
import calendar from '../../../../../capabilities/calendar/definition.ts';
import scale from '../../../../../capabilities/scalesmiths/definition.ts';
import type { CapabilityInvocationProposal, InvocationResult } from '@jarvis/contracts';
const now='2026-10-02T08:00:00.000Z';
function job(provider='email',action='search',input:unknown={query:'test',limit:50},mode:'full'|'dry-run'='full'):AdapterJob {
  return {invocationId:'inv',capabilityId:`capabilities.${provider}`,version:'2.0.0',action,input,mode,timeoutMs:30000,riskClass:'LOW',executionEnvironment:'worker',moduleUrl:new URL(`../../../../../capabilities/${provider}/definition.ts`,import.meta.url).href,handle:{handleId:'h',invocationId:'inv',scope:{capabilityId:`capabilities.${provider}`,action:mode==='dry-run'?'verify':action,resourceRef:action},mode,expiresAt:'2099-01-01T00:00:00Z',kind:'wrapped-static'}};
}
const material={principalId:'p1',clientId:'client',clientSecret:'private-secret',refreshToken:'private-refresh',calendars:['primary']};
function setup(principalId='p1',value:unknown=material,results:unknown[]=[{access_token:'private-access'},{messages:[{id:'m1'}]}],readOnly=false) {
  const fetcher=vi.fn(async(_url:string|URL|Request,_init?:RequestInit)=>new Response(JSON.stringify(results.shift()??{}),{status:200}));
  const redeem=vi.fn(()=>({principalId,readOnly,use:<T>(fn:(secret:string)=>T)=>fn(JSON.stringify(value))}));
  return {transport:new IntegrationTransport({redeem} as unknown as CredentialBroker,fetcher as unknown as typeof fetch),fetcher,redeem};
}
describe('operational integrations',()=>{
  it('keeps every write approval gated and avoids auto-retrying non-idempotent sends',()=>{
    for(const definition of [email,calendar,scale])for(const action of definition.manifest.actions)if(action.sideEffects.length)expect(action.approvalPolicy).toBe('always');
    expect(email.manifest.actions.find(a=>a.name==='send')).toMatchObject({riskClass:'HIGH',idempotent:false,simulatable:false});
    expect(email.actions.send!.input.safeParse({to:['a@example.com'],subject:'bad\r\nBcc: hidden',body:'x'}).success).toBe(false);
    expect(scale.manifest.actions.map(a=>a.name)).toEqual(expect.arrayContaining(['clients.read','leads.update','tasks.update','caseStudies.read']));
  });
  it('binds mailbox credentials to the principal before contacting Google',async()=>{
    const s=setup('p2');await expect(s.transport.run(job(),{method:'POST',url:'integration://email/search'})).rejects.toThrow('principal mismatch');expect(s.fetcher).not.toHaveBeenCalled();
  });
  it('rejects arbitrary egress and credential scope substitution',async()=>{
    const s=setup();await expect(s.transport.run(job(),{method:'POST',url:'https://attacker.invalid'})).rejects.toThrow('Egress denied');
    const j=job();j.handle.scope.action='send';await expect(s.transport.run(j,{method:'POST',url:'integration://email/search'})).rejects.toThrow('binding mismatch');
  });
  it('refreshes Google credentials only inside the kernel and returns no tokens',async()=>{
    const s=setup();const output=await s.transport.run(job(),{method:'POST',url:'integration://email/search'});
    expect(output).toEqual({data:{messages:[{id:'m1'}]}});expect(JSON.stringify(output)).not.toContain('private-');
    expect(s.fetcher.mock.calls[0]?.[0]).toBe('https://oauth2.googleapis.com/token');
    expect(s.fetcher.mock.calls[1]?.[1]?.headers).toEqual({authorization:'Bearer private-access'});
    expect(s.fetcher).toHaveBeenCalledTimes(2);
  });
  it('verifies sends by reading the resulting message without sending again',async()=>{
    const mail={id:'m1',labelIds:['SENT'],payload:{mimeType:'text/plain',headers:[{name:'To',value:'a@example.com'},{name:'Subject',value:'Hello'}],body:{data:Buffer.from('Body').toString('base64url')}}};
    const s=setup('p1',material,[{access_token:'access'},mail],true);
    const j=job('email','send',{to:['a@example.com'],subject:'Hello',body:'Body'},'dry-run');j.output={data:{id:'m1'}};
    expect(await s.transport.run(j,{method:'GET',url:'integration://email/send'})).toEqual({data:mail});
    expect(s.fetcher).toHaveBeenCalledTimes(2);
  });
  it('does not let calendar input change the authorized calendar set',async()=>{
    const s=setup();await expect(s.transport.run(job('calendar','events.read',{calendarId:'other',timeMin:now,timeMax:'2026-10-03T08:00:00Z'}),{method:'POST',url:'integration://calendar/events.read'})).rejects.toThrow('not authorized');
  });
  it('keeps unavailable ScaleSmiths mutations closed and validates page completeness',async()=>{
    const s=setup('p1',{principalId:'p1',baseUrl:'https://service.example/api/jarvis/',token:'secret',contractVersion:1,mutations:[]});
    await expect(s.transport.run(job('scalesmiths','leads.update',{id:'1',patch:{status:'won'}}),{method:'POST',url:'integration://scalesmiths/leads.update'})).rejects.toThrow('not supported');expect(s.fetcher).not.toHaveBeenCalled();
    expect(scalePageSchema.safeParse({records:[],complete:false}).success).toBe(false);
  });
  it('creates and reads back a Gmail draft with encoded Unicode content',async()=>{
    const s=setup('p1',material,[{access_token:'access'},{id:'draft1'},{id:'draft1',message:{id:'m1',labelIds:['DRAFT'],payload:{mimeType:'text/plain',headers:[{name:'To',value:'fixture@example.com'},{name:'Subject',value:'Meeting ✓'}],body:{data:Buffer.from('Hello').toString('base64url')}}}}]);
    const j=job('email','draft.create',{to:['fixture@example.com'],subject:'Meeting ✓',body:'Hello'});
    const result=await s.transport.run(j,{method:'POST',url:'integration://email/draft.create'});expect(result).toMatchObject({data:{id:'draft1'}});
    const body=JSON.parse(String(s.fetcher.mock.calls[1]?.[1]?.body));expect(Buffer.from(body.message.raw,'base64url').toString()).toContain('Content-Type: text/plain; charset=UTF-8');expect(s.fetcher.mock.calls[2]?.[0]).toBe('https://gmail.googleapis.com/gmail/v1/users/me/drafts/draft1?format=full');
  });
  it('fails archive verification when the provider retains INBOX',async()=>{
    const s=setup('p1',material,[{access_token:'access'},{id:'m1'},{id:'m1',labelIds:['INBOX']}]);await expect(s.transport.run(job('email','archive',{messageId:'m1'}),{method:'POST',url:'integration://email/archive'})).rejects.toThrow('Archive not confirmed');
  });
  it('rejects Calendar readback that does not contain the approved event fields',async()=>{
    const event={summary:'Approved title',start:{dateTime:now},end:{dateTime:'2026-10-02T09:00:00Z'}};
    const s=setup('p1',material,[{access_token:'access'},{id:'event1'},{id:'event1',...event,summary:'Unchanged title'}]);
    await expect(s.transport.run(job('calendar','event.update',{calendarId:'primary',eventId:'event1',event}),{method:'POST',url:'integration://calendar/event.update'})).rejects.toThrow('intent not confirmed');
  });
  it('changes only the self attendee for RSVP and independently confirms the response',async()=>{
    const current={id:'event1',attendees:[{email:'me@example.com',self:true,responseStatus:'needsAction'},{email:'other@example.com',responseStatus:'accepted'}]};
    const s=setup('p1',material,[{access_token:'access'},current,{}, {...current,attendees:[{...current.attendees[0],responseStatus:'declined'},current.attendees[1]]}]);
    const result=await s.transport.run(job('calendar','RSVP',{calendarId:'primary',eventId:'event1',response:'declined'}),{method:'POST',url:'integration://calendar/RSVP'});expect(result).toMatchObject({data:{id:'event1'}});
    const patch=JSON.parse(String(s.fetcher.mock.calls[2]?.[1]?.body));expect(patch.attendees[1]).toEqual(current.attendees[1]);expect(patch.attendees[0].responseStatus).toBe('declined');
  });
  it('reads availability via freeBusy POST even under read-only verification authority',async()=>{
    const s=setup('p1',material,[{access_token:'access'},{calendars:{primary:{busy:[]}}}],true);
    await s.transport.run(job('calendar','availability.read',{calendarId:'primary',timeMin:now,timeMax:'2026-10-03T08:00:00Z'},'dry-run'),{method:'GET',url:'integration://calendar/availability.read'});
    expect(s.fetcher.mock.calls[1]?.[1]?.method).toBe('POST');expect(JSON.parse(String(s.fetcher.mock.calls[1]?.[1]?.body))).toMatchObject({items:[{id:'primary'}]});
  });
});
function intelligence(){const ingest=vi.fn(async()=>({routed:{targets:[],rationale:'test'},emittedEventIds:[]}));return {ingest,business:new BusinessIntelligence({knowledge:{ingest},agency:{} as never,objectives:{} as never,context:{} as never,nodeId:'n1',now:()=>now,id:()=> 'id'})};}
async function capture(business:BusinessIntelligence,area:string,data:unknown,input:unknown={},principal='p1'){
  const proposal={proposalId:'p',kind:'capability_invocation',correlationId:'c',confidence:1,provenance:{},invocation:{capabilityId:'capabilities.scalesmiths',capabilityVersion:'2.0.0',action:`${area}.read`,input},justification:'read'} as CapabilityInvocationProposal;
  await business.capture(proposal,{invocationId:'i',outcome:'verified',output:{data},finishedAt:now} as InvocationResult,principal);
}
describe('business evidence and privacy',()=>{
  it('reports unknown rather than zero without data and isolates principals',async()=>{
    const {business}=intelligence();expect(business.picture('p1').readings.MRR?.status).toBe('unavailable');
    await capture(business,'retainers',{records:[],complete:true});expect(business.picture('p1').readings.MRR?.status).toBe('available');expect(business.picture('p2').readings.MRR?.status).toBe('unavailable');
  });
  it('preserves provenance and privacy through Knowledge Ingestion only',async()=>{
    const {business,ingest}=intelligence();await capture(business,'retainers',{records:[{id:'r',entityType:'retainer',attributes:{status:'active',amountMinor:39500,currency:'GBP',period:'month'},sourceRef:'service:r',observedAt:now,confidence:0.9,privacy:'RESTRICTED'}],complete:true});
    expect(business.picture('p1').readings.MRR?.value).toEqual({amountMinorByCurrency:{GBP:39500}});
    expect(ingest).toHaveBeenCalledWith(expect.objectContaining({principalId:'p1',privacyHint:'RESTRICTED',provenance:expect.objectContaining({sourceRefs:['invocation:i','service:r'],derivedFromUntrusted:true}),fact:expect.objectContaining({confidence:0.9,epistemicStatus:'retrieved',validFrom:now})}));
  });
  it('does not produce MRR from incomplete or client-filtered pages',async()=>{
    const {business}=intelligence();await capture(business,'retainers',{records:[],complete:false,cursor:'next'});expect(business.picture('p1').readings.MRR?.status).toBe('unavailable');
    await capture(business,'retainers',{records:[],complete:true},{clientId:'client'});expect(business.picture('p1').readings.MRR?.status).toBe('unavailable');
  });
  it('does not invent a zero MRR from records with an unknown status mapping',async()=>{
    const {business}=intelligence();await capture(business,'retainers',{records:[{id:'r',entityType:'retainer',attributes:{status:'enabled',amountMinor:39500,currency:'GBP',period:'month'},sourceRef:'service:r',observedAt:now,confidence:1,privacy:'RESTRICTED'}],complete:true});expect(business.picture('p1').readings.MRR?.status).toBe('unavailable');
  });
});
