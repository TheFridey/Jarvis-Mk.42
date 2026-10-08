import { afterEach,describe,expect,it,vi } from 'vitest';
import { VoiceGateway } from './voice-gateway.ts';
import { safeVoiceAudioState } from './audio-state.ts';
const audio={observedAt:'untrusted',wakeConfidence:null,vad:'speech' as const,amplitude:.25,tts:'playing' as const,playbackAmplitude:.2,deviceState:'ready' as const};
describe('safe voice projection',()=>{
 afterEach(()=>vi.unstubAllEnvs());
 it('keeps private voice turns out of subsequent cloud conversation',async()=>{
  vi.stubEnv('JARVIS_CONVERSATION_CLOUD_ALLOWED','true');
  const submit=vi.fn(async(_request:{input:string})=>({answer:'private answer'}));
  const gateway=new VoiceGateway({principalId:'p',sessions:{get:async()=>({id:'s',state:'active',principalId:'p',nodes:['n']}),touch:async()=>{}},mode:{current:async()=> 'ENGAGED',requestTransition:async()=>{}},events:{emit:async()=>{}},cognition:{submit}} as unknown as ConstructorParameters<typeof VoiceGateway>[0]);
  const base={commandId:'c',principalId:'p',nodeId:'n'};
  await gateway.handle({...base,event:{type:'asr.final',sessionId:'s',sequence:1,text:'Show my invoices'}});
  await gateway.handle({...base,event:{type:'asr.final',sessionId:'s',sequence:2,text:'Hey Jarvis'}});
  const request=submit.mock.calls[1]![0];
  expect(request).toMatchObject({contextScope:'conversation',cloudAllowed:true,currentTurnInput:'Hey Jarvis'});
  expect(request.input).not.toContain('private answer');expect(request.input).not.toContain('invoices');
 });
 it('cannot submit cognition through an ended RTC session',async()=>{const submit=vi.fn(),touch=vi.fn();const gateway=new VoiceGateway({principalId:'p',sessions:{get:async()=>({id:'s',state:'ended',principalId:'p',nodes:['n']}),touch},cognition:{submit}} as unknown as ConstructorParameters<typeof VoiceGateway>[0]);await expect(gateway.handle({commandId:'c',principalId:'p',nodeId:'n',event:{type:'asr.final',sessionId:'s',sequence:1,text:'question'}})).rejects.toThrow('voice session');expect(submit).not.toHaveBeenCalled();expect(touch).not.toHaveBeenCalled();});
 it('rejects PCM, invalid readings and oversized sensitive content',()=>{expect(safeVoiceAudioState(audio).observedAt).not.toBe('untrusted');for(const state of [{...audio,pcm:'raw'},{...audio,amplitude:Infinity},{...audio,wakeConfidence:2},{...audio,finalTranscript:'x'.repeat(2049)}])expect(()=>safeVoiceAudioState(state)).toThrow('invalid audio state');});
 it('expires and isolates observations without executing cognition or creating sessions',async()=>{
  const cognition={submit:vi.fn()},sessions={open:vi.fn()};const gateway=new VoiceGateway({principalId:'p',cognition,sessions} as unknown as ConstructorParameters<typeof VoiceGateway>[0]);
  await gateway.handle({commandId:'c',principalId:'p',nodeId:'n',event:{type:'audio.state',state:audio}});expect(gateway.audioSnapshot()?.amplitude).toBe(.25);expect(cognition.submit).not.toHaveBeenCalled();expect(sessions.open).not.toHaveBeenCalled();
  await expect(gateway.handle({commandId:'c',principalId:'other',nodeId:'n',event:{type:'audio.state',state:audio}})).rejects.toThrow('principal mismatch');
  vi.useFakeTimers();vi.setSystemTime(Date.now()+4000);expect(gateway.audioSnapshot()).toBeUndefined();vi.useRealTimers();
 });
 it('supplies bounded prior turns for follow-ups and rejects old final sequences',async()=>{
  const submit=vi.fn(async(_request:{input:string})=>({answer:'first answer'}));const gateway=new VoiceGateway({principalId:'p',sessions:{get:async()=>({id:'s',state:'active',principalId:'p',nodes:['n']}),touch:async()=>{}},mode:{current:async()=> 'ENGAGED',requestTransition:async()=>{}},events:{emit:async()=>{}},cognition:{submit}} as unknown as ConstructorParameters<typeof VoiceGateway>[0]);
  const base={commandId:'c',principalId:'p',nodeId:'n'};await gateway.handle({...base,event:{type:'asr.final',sessionId:'s',sequence:1,text:'first question'}});await gateway.handle({...base,event:{type:'barge-in',sessionId:'s'}});await gateway.handle({...base,event:{type:'asr.final',sessionId:'s',sequence:2,text:'follow-up'}});
  expect(submit.mock.calls[1]?.[0]).toMatchObject({input:expect.stringContaining('first answer'),currentTurnInput:'follow-up'});
  await expect(gateway.handle({...base,event:{type:'asr.final',sessionId:'s',sequence:1,text:'replay'}})).rejects.toThrow('stale voice transcript');expect(submit).toHaveBeenCalledTimes(2);
 });
});
