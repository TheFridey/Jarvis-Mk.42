import type { ModelResponse } from '@jarvis/contracts';
/** Only retain numeric provider observations; limits can be shared across models. */
export function observedLimits(headers:Headers,provider:string):ModelResponse['usage']['limits'] {
 const prefix=provider==='anthropic'?'anthropic-ratelimit-':'x-ratelimit-';
 const read=(name:string)=>{const raw=headers.get(prefix+name);if(raw===null||raw.trim()==='')return undefined;const n=Number(raw);return Number.isFinite(n)&&n>=0?n:undefined;};
 const requests=read('requests-limit')??read('limit-requests'),remainingRequests=read('requests-remaining')??read('remaining-requests');
 const tokens=read('tokens-limit')??read('limit-tokens'),remainingTokens=read('tokens-remaining')??read('remaining-tokens');
 if([requests,remainingRequests,tokens,remainingTokens].every(v=>v===undefined))return undefined;
 return {observedAt:new Date().toISOString(),scope:'provider bucket',requests,remainingRequests,tokens,remainingTokens,
  resetRequests:headers.get(prefix+'requests-reset')??headers.get(prefix+'reset-requests')??undefined,
  resetTokens:headers.get(prefix+'tokens-reset')??headers.get(prefix+'reset-tokens')??undefined};
}
