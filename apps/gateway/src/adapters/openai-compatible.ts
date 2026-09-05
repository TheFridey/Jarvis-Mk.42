import type { ModelHealth, ModelRegistration, ModelRequest, ModelResponse } from '@jarvis/contracts';
import type { ProviderAdapter } from '../provider.ts';
import { httpError, parseOutput, prompt, response, type Fetch } from './shared.ts';

export class OpenAICompatibleAdapter implements ProviderAdapter {
  constructor(readonly provider: string, private readonly baseUrl: string, private readonly apiKey = '', private readonly fetcher: Fetch = fetch) {}
  async generate(model: ModelRegistration, request: ModelRequest, signal: AbortSignal): Promise<ModelResponse> {
    const started = Date.now();
    const res = await this.fetcher(`${this.baseUrl}/chat/completions`, { method: 'POST', signal, headers: { 'content-type': 'application/json', ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) }, body: JSON.stringify({ model: model.id, messages: [{ role: 'system', content: 'Return only valid JSON matching the requested JARVIS proposal contract.' }, { role: 'user', content: prompt(request) }], max_tokens: request.budget.maxOutput, temperature: request.determinism === 'creative' ? 0.7 : 0 }) });
    if (!res.ok) throw httpError(this.provider, res.status, await res.text());
    const body = await res.json() as { choices?: Array<{ message?: { content?: unknown } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    return response(model, parseOutput(body.choices?.[0]?.message?.content), body.usage?.prompt_tokens ?? request.budget.contextUnits, body.usage?.completion_tokens ?? 0, Date.now() - started);
  }
  async health(model: ModelRegistration, signal: AbortSignal): Promise<ModelHealth> { const started = Date.now(); const res = await this.fetcher(`${this.baseUrl}/models`, { signal, headers: this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {} }); return { modelId: model.id, provider: this.provider, status: res.ok ? 'healthy' : 'offline', checkedAt: new Date().toISOString(), latencyMs: Date.now() - started, ...(!res.ok ? { detail: `HTTP ${res.status}` } : {}) }; }
}
