import {expect,it} from 'vitest';
import {observedLimits} from './observed-limits.ts';
import {OpenAICompatibleAdapter} from './openai-compatible.ts';
it('preserves OpenAI and Anthropic limit observations without converting missing fields to zero',()=>{
 expect(observedLimits(new Headers({'x-ratelimit-limit-requests':'100','x-ratelimit-remaining-requests':'0','x-ratelimit-reset-requests':'2s'}),'openai')).toMatchObject({requests:100,remainingRequests:0,resetRequests:'2s'});
 expect(observedLimits(new Headers({'anthropic-ratelimit-tokens-limit':'50000','anthropic-ratelimit-tokens-remaining':'12000'}),'anthropic')).toMatchObject({tokens:50000,remainingTokens:12000});
 expect(observedLimits(new Headers({'x-ratelimit-limit-tokens':'NaN'}),'openai')).toBeUndefined();
 expect(observedLimits(new Headers(),'openai')).toBeUndefined();
});
it('records OpenRouter billed cost including a genuine zero, while keeping missing cost unknown',async()=>{
 const model={id:'route',provider:'openrouter',costPerContextUnit:0,costPerOutputUnit:0} as never;
 const request={input:{instruction:'x',context:{},constraints:[]},budget:{contextUnits:1,maxOutput:10}} as never;
 for(const cost of [undefined,0,.012]){
  const adapter=new OpenAICompatibleAdapter('openrouter','http://fixture','key',async()=>Response.json({choices:[{message:{content:'{"proposals":[]}'}}],usage:{prompt_tokens:2,completion_tokens:3,...(cost!==undefined?{cost}:{})}}));
  const response=await adapter.generate(model,request,AbortSignal.timeout(1000));
  expect(response.usage.actualCost).toBe(cost);
 }
});
it('reads shared OpenRouter key limits on the server and tolerates billing endpoint failure',async()=>{
 const model={id:'route',provider:'openrouter',costPerContextUnit:0,costPerOutputUnit:0} as never;
 const request={input:{instruction:'x',context:{},constraints:[]},budget:{contextUnits:1,maxOutput:10}} as never;
 let keyCalls=0;
 const adapter=new OpenAICompatibleAdapter('openrouter','http://fixture','private-key',async(url,init)=>{
  if(String(url).endsWith('/key')){keyCalls++;expect((init?.headers as Record<string,string>).authorization).toBe('Bearer private-key');return Response.json({data:{limit:20,limit_remaining:0}});}
  return Response.json({choices:[{message:{content:'{}'}}],usage:{cost:.01}});
 });
 const response=await adapter.generate(model,request,AbortSignal.timeout(1000));
 expect(response.usage.limits).toMatchObject({keyLimitUSD:20,keyRemainingUSD:0,scope:'OpenRouter API key · shared across models'});
 await adapter.generate(model,request,AbortSignal.timeout(1000));expect(keyCalls).toBe(1);
 const unavailable=new OpenAICompatibleAdapter('openrouter','http://fixture','private-key',async url=>String(url).endsWith('/key')?new Response('',{status:503}):Response.json({choices:[{message:{content:'{}'}}],usage:{cost:.01}}));
 expect((await unavailable.generate(model,request,AbortSignal.timeout(1000))).usage.actualCost).toBe(.01);
});
