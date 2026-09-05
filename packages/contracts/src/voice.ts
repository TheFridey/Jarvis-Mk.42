import type { CognitionResponse } from './cognition.ts';
export type VoiceActivationKind='push-to-talk'|'manual'|'wake-phrase';
export type VoicePerceptionEvent=
 |{type:'activation';activation:VoiceActivationKind;deviceId:string;sessionId?:string}
 |{type:'asr.partial';text:string;sequence:number;sessionId:string}
 |{type:'asr.final';text:string;sequence:number;sessionId:string}
 |{type:'barge-in';sessionId:string}
 |{type:'silence';durationMs:number;sessionId:string}
 |{type:'device.changed';deviceId:string;sessionId?:string}
 |{type:'device.lost';deviceId:string;sessionId?:string}
 |{type:'deactivate';sessionId:string};
export interface VoiceEventCommand{commandId:string;principalId:string;nodeId:string;event:VoicePerceptionEvent}
export interface VoiceEventResponse{sessionId:string;state:'listening'|'thinking'|'speaking'|'idle'|'degraded';cognition?:CognitionResponse;utterance?:string}
