import type { AudioVisualEnvelope } from '@jarvis/scene';

export const AUDIO_ENVELOPE_EVENT='jarvis:audio-envelope';
const zero:AudioVisualEnvelope={schemaVersion:1,source:'microphone',sequence:0,observedAt:'',amplitude:0,low:0,mid:0,high:0};
const clamp=(value:number)=>Number.isFinite(value)?Math.max(0,Math.min(1,value)):0;
export function sanitizeAudioEnvelope(value:AudioVisualEnvelope):AudioVisualEnvelope{return{...value,schemaVersion:1,sequence:Math.max(0,Math.floor(value.sequence)),amplitude:clamp(value.amplitude),low:clamp(value.low),mid:clamp(value.mid),high:clamp(value.high)}}
export class AudioEnvelopeStore{
  private value=zero;private listeners=new Set<()=>void>();private latest={microphone:-1,tts:-1};
  publish(input:AudioVisualEnvelope){const value=sanitizeAudioEnvelope(input);if(value.sequence<=this.latest[value.source])return false;this.latest[value.source]=value.sequence;this.value=value;for(const listener of this.listeners)listener();return true}
  current=()=>this.value;subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>this.listeners.delete(listener)};
}
export const audioEnvelopeStore=new AudioEnvelopeStore();
export function connectAudioEnvelopeEvents(target:Pick<Window,'addEventListener'|'removeEventListener'>=window){const receive=(event:Event)=>{if(event instanceof CustomEvent)audioEnvelopeStore.publish(event.detail as AudioVisualEnvelope)};target.addEventListener(AUDIO_ENVELOPE_EVENT,receive);return()=>target.removeEventListener(AUDIO_ENVELOPE_EVENT,receive)}
