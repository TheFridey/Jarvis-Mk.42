import type { CognitionResponse } from '@jarvis/contracts';
export function latestConversationAnswer(responses:readonly CognitionResponse[]):CognitionResponse|undefined{
  return responses.filter(response=>Boolean(response.answer)).reduce<CognitionResponse|undefined>((latest,response)=>{
    const at=Date.parse(response.result.finishedAt??response.createdAt),previous=latest?Date.parse(latest.result.finishedAt??latest.createdAt):-Infinity;
    return !latest||at>previous?response:latest;
  },undefined);
}
