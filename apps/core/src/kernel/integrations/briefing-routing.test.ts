import { describe, expect, it, vi } from 'vitest';
import { BusinessIntelligence, isBusinessBriefingRequest } from './intelligence.ts';

describe('business briefing intent', () => {
  it('reads only requested supported sources and skips unconfigured capabilities', async () => {
    const submitOnce=vi.fn(async(_proposal:unknown)=>({outcome:'rejected'}));
    const business=new BusinessIntelligence({agency:{submitOnce},hasRead:(provider:string,action:string)=>provider==='scalesmiths'&&action==='clients.read',now:()=> '2026-10-08T12:00:00Z',id:()=> 'read'} as unknown as ConstructorParameters<typeof BusinessIntelligence>[0]);
    await business.answer('operator','Show my clients','clients');
    expect(submitOnce).toHaveBeenCalledTimes(1);
    expect(submitOnce.mock.calls[0]?.[0]).toMatchObject({invocation:{action:'clients.read'}});
    submitOnce.mockClear();
    await business.answer('operator','What invoices are outstanding?','invoices');
    expect(submitOnce).not.toHaveBeenCalled();
  });
  it.each(['Hey Jarvis', 'Good morning Jarvis, how are you today?', 'Morning!', 'Good morning Jarvis', 'Hello Jarvis'])('keeps %s on the conversation path', async text => {
    const business = new BusinessIntelligence({} as ConstructorParameters<typeof BusinessIntelligence>[0]);
    const refresh = vi.spyOn(business, 'refresh');
    expect(await business.answer('operator', text, 'greeting')).toBeUndefined();
    expect(refresh).not.toHaveBeenCalled();
  });

  it.each(['Jarvis, morning. Give me the situation.', 'Give me my morning briefing', 'Morning update please', 'Which leads have gone cold?', 'What invoices are outstanding?', 'Who needs following up?'])('recognises %s', text => {
    expect(isBusinessBriefingRequest(text)).toBe(true);
  });

  it('explains missing sources without dumping unavailable fields', async () => {
    const business = new BusinessIntelligence({now: () => '2026-10-06T08:39:53.041Z'} as ConstructorParameters<typeof BusinessIntelligence>[0]);
    vi.spyOn(business, 'refresh').mockResolvedValue({picture: business.picture('operator'), unavailable: ['clients.read']});
    const answer = await business.answer('operator', 'Give me the situation', 'briefing');
    expect(answer).toContain('could not retrieve verified ScaleSmiths data');
    expect(answer).toContain('cannot report business figures');
    expect(answer).not.toContain('activeRetainers');
    expect(answer).not.toContain('no source');
  });
});
