import { describe,it,expect } from 'vitest';
import { VoiceGateway } from './voice-gateway.ts';
describe('voice runtime telemetry ingress',()=>{
 it('accepts bounded runtime observations without conversation or effect authority',async()=>{const gateway=new VoiceGateway({} as ConstructorParameters<typeof VoiceGateway>[0]);await gateway.handle({commandId:'c',principalId:'p',nodeId:'n',event:{type:'runtime.health',ready:true,deviceReady:true,processingLatencyMs:12,droppedObservations:3}});expect(gateway.diagnostics()).toMatchObject({ready:true,deviceReady:true,processingLatencyMs:12,droppedObservations:3});});
 it('rejects malformed counts and latency',async()=>{const gateway=new VoiceGateway({} as ConstructorParameters<typeof VoiceGateway>[0]);await expect(gateway.handle({commandId:'c',principalId:'p',nodeId:'n',event:{type:'runtime.health',ready:true,deviceReady:true,processingLatencyMs:NaN,droppedObservations:-1}})).rejects.toThrow('invalid voice runtime telemetry');expect(gateway.diagnostics()).toBeUndefined();});
});
