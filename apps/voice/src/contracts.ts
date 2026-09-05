import type{VoiceActivationKind,VoiceEventResponse}from'@jarvis/contracts';
export interface RecognitionEvent{type:'speech-start'|'partial'|'final'|'silence'|'device-lost';text?:string;durationMs?:number;deviceId:string}
export interface SpeechInput{start(listener:(event:RecognitionEvent)=>void):Promise<void>;stop():Promise<void>;switchDevice(deviceId:string):Promise<void>}
export interface SpeechOutput{speak(text:string,signal:AbortSignal):Promise<void>;stop():Promise<void>}
export interface VoiceKernel{send(event:import('@jarvis/contracts').VoicePerceptionEvent):Promise<VoiceEventResponse>}
export interface ActivationStrategy{kind:VoiceActivationKind;matches(event:RecognitionEvent):boolean}
export interface VoiceActivityDetector{observe(frame:Uint8Array):'speech'|'silence'|'unknown'}
