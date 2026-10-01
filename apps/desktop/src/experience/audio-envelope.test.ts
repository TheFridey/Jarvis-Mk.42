import { describe,expect,it,vi } from 'vitest';
import { AudioEnvelopeStore,sanitizeAudioEnvelope } from './audio-envelope.ts';
describe('audio envelope bridge',()=>{
  it('bounds derived values and never accepts raw samples',()=>{expect(sanitizeAudioEnvelope({schemaVersion:1,source:'microphone',sequence:1,observedAt:'now',amplitude:4,low:-1,mid:.5,high:Number.NaN})).toMatchObject({amplitude:1,low:0,mid:.5,high:0})});
  it('drops duplicate and out-of-order frames',()=>{const store=new AudioEnvelopeStore();const listener=vi.fn();store.subscribe(listener);expect(store.publish({schemaVersion:1,source:'tts',sequence:2,observedAt:'now',amplitude:.2,low:.1,mid:.2,high:.3})).toBe(true);expect(store.publish({schemaVersion:1,source:'tts',sequence:1,observedAt:'now',amplitude:1,low:1,mid:1,high:1})).toBe(false);expect(listener).toHaveBeenCalledOnce()})
});
