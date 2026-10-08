import type { ModelRegistration, ModelRequest } from '@jarvis/contracts';
import { OpenAICompatibleAdapter } from './openai-compatible.ts';
// OpenAI reasoning models reject max_tokens and any non-default temperature with HTTP 400.
const reasoningModel = /^(?:gpt-[56]|o\d)/i;
export class OpenAIAdapter extends OpenAICompatibleAdapter {
  constructor(apiKey: string, baseUrl = 'https://api.openai.com/v1', fetcher: typeof fetch = fetch) { super('openai', baseUrl, apiKey, fetcher); }
  protected override samplingParameters(model: ModelRegistration, request: ModelRequest): Record<string, number> {
    return { max_completion_tokens: request.budget.maxOutput, ...(reasoningModel.test(model.id) ? {} : { temperature: request.determinism === 'creative' ? 0.7 : 0 }) };
  }
}
