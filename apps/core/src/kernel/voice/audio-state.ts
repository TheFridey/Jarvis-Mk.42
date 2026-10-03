import type { VoiceAudioState } from '@jarvis/contracts';
/** Construct allowlisted output; reject raw audio and invalid readings. */
export function safeVoiceAudioState(input:unknown):VoiceAudioState {
 if(!input||typeof input!=='object')throw new Error('invalid audio state');
 const v=input as Record<string,unknown>;
 if(Object.keys(v).some(k=>!['observedAt','wakeConfidence','vad','amplitude','partialTranscript','finalTranscript','tts','playbackAmplitude','deviceState'].includes(k)))throw new Error('invalid audio state');
 for(const key of ['wakeConfidence','amplitude','playbackAmplitude']){if(key==='wakeConfidence'&&v[key]===null)continue;if(typeof v[key]!=='number'||!Number.isFinite(v[key])||Number(v[key])<0||Number(v[key])>1)throw new Error('invalid audio state');}
 if(!['speech','silence','unknown'].includes(String(v.vad))||!['idle','synthesizing','playing','cancelled'].includes(String(v.tts))||!['ready','lost','recovering'].includes(String(v.deviceState)))throw new Error('invalid audio state');
 for(const key of ['partialTranscript','finalTranscript'])if(v[key]!==undefined&&(typeof v[key]!=='string'||String(v[key]).length>2048))throw new Error('invalid audio state');
 return {observedAt:new Date().toISOString(),wakeConfidence:v.wakeConfidence as number|null,vad:v.vad as VoiceAudioState['vad'],amplitude:v.amplitude as number,tts:v.tts as VoiceAudioState['tts'],playbackAmplitude:v.playbackAmplitude as number,deviceState:v.deviceState as VoiceAudioState['deviceState'],...(typeof v.partialTranscript==='string'?{partialTranscript:v.partialTranscript}:{}),...(typeof v.finalTranscript==='string'?{finalTranscript:v.finalTranscript}:{})};
}
