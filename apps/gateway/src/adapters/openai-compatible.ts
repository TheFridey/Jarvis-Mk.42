import type { ModelHealth, ModelRegistration, ModelRequest, ModelResponse } from '@jarvis/contracts';
import { observedLimits } from './observed-limits.ts';
import type { ProviderAdapter } from '../provider.ts';
import { httpError, parseOutput, prompt, response, truncatedOutput, type Fetch } from './shared.ts';

export class OpenAICompatibleAdapter implements ProviderAdapter {
  private keyObservation?:ModelResponse['usage']['limits'];
  private keyCheckedAt=0;
  private keyPending?:Promise<ModelResponse['usage']['limits']>;
  private async keyLimits(signal:AbortSignal):Promise<ModelResponse['usage']['limits']>{
    if(this.provider!=='openrouter'||!this.apiKey)return undefined;
    if(Date.now()-this.keyCheckedAt<60000)return this.keyObservation;
    if(this.keyPending)return this.keyPending;
    this.keyPending=(async()=>{this.keyCheckedAt=Date.now();try{
      const result=await this.fetcher(`${this.baseUrl}/key`,{signal:AbortSignal.any([signal,AbortSignal.timeout(2500)]),headers:{authorization:`Bearer ${this.apiKey}`}});
      if(!result.ok)return undefined;
      const {data}=await result.json() as {data?:{limit?:number|null;limit_remaining?:number|null}};
      if(!data)return undefined;
      const finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
      this.keyObservation={observedAt:new Date().toISOString(),scope:'OpenRouter API key · shared across models',...(finite(data.limit)?{keyLimitUSD:data.limit}:{}),...(finite(data.limit_remaining)?{keyRemainingUSD:data.limit_remaining}:{}),...(data.limit===null?{keyUnlimited:true}:{})};
      return this.keyObservation;
    }catch{return undefined;}})().finally(()=>{this.keyPending=undefined;});
    return this.keyPending;
  }
  constructor(readonly provider: string, private readonly baseUrl: string, private readonly apiKey = '', private readonly fetcher: Fetch = fetch) {}
  async generate(model: ModelRegistration, request: ModelRequest, signal: AbortSignal): Promise<ModelResponse> {
    const started = Date.now();
    const res = await this.fetcher(`${this.baseUrl}/chat/completions`, { method: 'POST', signal, headers: { 'content-type': 'application/json', ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) }, body: JSON.stringify({ model: model.id, messages: [{ role: 'system', content: 'Return only valid JSON matching the requested JARVIS proposal contract.' }, { role: 'user', content: prompt(request) }], ...this.samplingParameters(model, request) }) });
    if (!res.ok) throw httpError(this.provider, res.status, await res.text());
    const body = await res.json() as { choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }>; usage?: { prompt_tokens?: number; prompt_tokens_details?:{cached_tokens?:number}; completion_tokens?: number; cost?: number } };
    if (body.choices?.[0]?.finish_reason === 'length') throw truncatedOutput(this.provider);
    const input=body.usage?.prompt_tokens,output=body.usage?.completion_tokens;
    const result = response(model, parseOutput(body.choices?.[0]?.message?.content), input??request.budget.contextUnits, output??0, Date.now() - started,{...(input!==undefined?{input}:{}),...(body.usage?.prompt_tokens_details?.cached_tokens!==undefined?{cached:body.usage.prompt_tokens_details.cached_tokens}:{}),...(output!==undefined?{output}:{})});
    const limits=observedLimits(res.headers,this.provider)??await this.keyLimits(signal);
    if(limits)result.usage.limits=limits;
    if(this.provider==='openrouter'&&typeof body.usage?.cost==='number'&&Number.isFinite(body.usage.cost)&&body.usage.cost>=0)result.usage.actualCost=body.usage.cost;
    return result;
  }
  protected samplingParameters(_model: ModelRegistration, request: ModelRequest): Record<string, number> {
    return { max_tokens: request.budget.maxOutput, temperature: request.determinism === 'creative' ? 0.7 : 0 };
  }
  async health(model: ModelRegistration, signal: AbortSignal): Promise<ModelHealth> { const started = Date.now(); const res = await this.fetcher(`${this.baseUrl}/models`, { signal, headers: this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {} }); return { modelId: model.id, provider: this.provider, status: res.ok ? 'healthy' : 'offline', checkedAt: new Date().toISOString(), latencyMs: Date.now() - started, ...(!res.ok ? { detail: `HTTP ${res.status}` } : {}) }; }
}
