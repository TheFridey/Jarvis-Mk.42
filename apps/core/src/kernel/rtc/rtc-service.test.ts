import {describe,it,expect,vi,afterEach} from 'vitest';
import {RoomServiceClient} from 'livekit-server-sdk';
import type {VoiceGateway} from '../voice/voice-gateway.ts';
const mocks=vi.hoisted(()=>({close:vi.fn(async()=>{})}));
vi.mock('./rtc-agent.ts',()=>({connectRtcAgent:vi.fn(async()=>({close:mocks.close}))}));
import {RtcService,type RtcBinding} from './rtc-service.ts';
const binding:RtcBinding={principalId:'p',nodeId:'n',sessionId:'auth-session',accessToken:'test-only'};
let service:RtcService|undefined;
afterEach(async()=>{await service?.close();service=undefined;vi.restoreAllMocks();vi.useRealTimers();});
function setup(validate=vi.fn(async()=>true)){
 vi.spyOn(RoomServiceClient.prototype,'createRoom').mockResolvedValue({} as never);
 const remove=vi.spyOn(RoomServiceClient.prototype,'deleteRoom').mockResolvedValue();
 const handle=vi.fn(async()=>({sessionId:'voice-session',state:'listening' as const}));
 service=new RtcService({url:'ws://127.0.0.1:7880',apiKey:'test',apiSecret:'test-secret-with-sufficient-length',voice:{handle} as unknown as VoiceGateway,validate,invalidate:()=>{}});return{validate,remove,handle};
}
describe('RTC admission and lifecycle',()=>{
 it('releases pending admission capacity when the voice session cannot start',async()=>{const {handle}=setup();handle.mockRejectedValueOnce(new Error('storage unavailable'));await expect(service!.join(binding)).rejects.toThrow('storage');await expect(service!.join(binding)).resolves.toHaveProperty('sessionId','voice-session');});
 it('refuses invalid credentials before creating a media room',async()=>{const {remove,handle}=setup(vi.fn(async()=>false));await expect(service!.join(binding)).rejects.toThrow('binding');expect(handle).not.toHaveBeenCalled();expect(remove).not.toHaveBeenCalled();});
 it('issues an opaque room-scoped microphone-only short-lived token',async()=>{setup();const result=await service!.join(binding);const claims=JSON.parse(Buffer.from(result.token.split('.')[1]!,'base64url').toString());expect(claims.video).toMatchObject({room:result.room,roomJoin:true,canPublishData:false,canPublishSources:['microphone']});expect(claims.video.roomAdmin).toBeUndefined();expect(claims.exp-claims.nbf).toBeLessThanOrEqual(15);expect(result.room).not.toContain('auth-session');});
 it('rejects cross-node cleanup and removes media when the credential is revoked',async()=>{vi.useFakeTimers();const {validate,remove}=setup();await service!.join(binding);await expect(service!.leave({...binding,nodeId:'other'})).rejects.toThrow('owner');validate.mockResolvedValue(false);await vi.advanceTimersByTimeAsync(2001);expect(remove).toHaveBeenCalled();expect(mocks.close).toHaveBeenCalled();});
 it('rechecks authority after an asynchronous media connection',async()=>{const validate=vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false);const {remove}=setup(validate);await expect(service!.join(binding)).rejects.toThrow('revoked');expect(remove).toHaveBeenCalled();});
});
