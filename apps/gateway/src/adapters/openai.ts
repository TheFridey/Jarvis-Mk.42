import { OpenAICompatibleAdapter } from './openai-compatible.ts';
export class OpenAIAdapter extends OpenAICompatibleAdapter { constructor(apiKey: string, baseUrl = 'https://api.openai.com/v1', fetcher: typeof fetch = fetch) { super('openai', baseUrl, apiKey, fetcher); } }
