import { expect, it, vi } from 'vitest';
import { AdapterHost } from './host.ts';
import type { AdapterJob } from './ipc.ts';
it('runs the Gmail adapter out of process with credential-free HTTP mediation',async()=>{
  const egress=vi.fn(async(_job:AdapterJob,_request:{url:string})=>({data:{messages:[{id:'m1'}]}}));
  const job:AdapterJob={invocationId:'i',capabilityId:'capabilities.email',version:'2.0.0',action:'search',input:{query:'test',limit:50},mode:'full',timeoutMs:30000,riskClass:'LOW',executionEnvironment:'worker',moduleUrl:new URL('../../../capabilities/email/definition.ts',import.meta.url).href,handle:{handleId:'h',invocationId:'i',scope:{capabilityId:'capabilities.email',action:'search',resourceRef:'search'},mode:'full',expiresAt:'2099-01-01T00:00:00Z',kind:'wrapped-static'}};
  const result=await new AdapterHost(undefined,egress).run(job);expect(result.output).toEqual({data:{messages:[{id:'m1'}]}});expect(egress).toHaveBeenCalledOnce();expect(egress.mock.calls[0]?.[1]).toMatchObject({url:'integration://email/search'});
},40000);
