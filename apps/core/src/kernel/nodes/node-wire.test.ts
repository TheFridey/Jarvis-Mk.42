import { describe,expect,it } from 'vitest';
import { descriptorSchema,frameSchema } from './node-wire.ts';
import { NodeIngress } from './node-ingress.ts';
describe('node wire boundary',()=>{
  const descriptor={nodeId:'display-1',nodeType:'display',protocolVersion:'1',sensors:[],capabilities:[],surfaces:['status-display'],requestedTrustTier:'guest',attributes:{}};
  it('accepts the existing declaration contract but rejects self-promotion and unknown versions',()=>{
    expect(descriptorSchema.safeParse(descriptor).success).toBe(true);
    expect(descriptorSchema.safeParse({...descriptor,nodeType:'future-headset'}).success).toBe(true);
    for(const override of [{requestedTrustTier:'kernel-local'},{protocolVersion:'2'},{nodeId:'../../admin'},{attributes:{secret:'x'.repeat(257)}}])expect(descriptorSchema.safeParse({...descriptor,...override}).success).toBe(false);
  });
  it('has no arbitrary event, capture, approval, executor, or subscription path',()=>{
    const base={requestId:'req-1',nodeId:'display-1',sessionId:'session',epoch:1,sequence:1,accessToken:'x'.repeat(43)};
    expect(frameSchema.safeParse({...base,type:'SUBSCRIBE',channel:'system-status'}).success).toBe(true);
    for(const frame of [{type:'SUBSCRIBE',channel:'approvals'},{type:'OPERATE',operationId:'op-1',observation:{sensor:'runtime-health',healthy:true,rawAudio:'secret'}},{type:'OPERATE',event:{type:'jarvis.agency.invocation.verified'}},{type:'REVOKE',nodeId:'kernel-server'},{type:'HEARTBEAT',nonce:'x'.repeat(43),rttMs:0}])expect(frameSchema.safeParse({...base,...frame}).success).toBe(false);
  });
  it('rejects every public or wildcard listener bind before accessing dependencies',async()=>{
    for(const host of ['0.0.0.0','::','192.168.1.20','localhost','example.com'])await expect(new NodeIngress({} as never).listen({host:host as never,ca:'',cert:'',key:''})).rejects.toThrow('loopback-only');
  });
});
