import type { ModelHealth, ModelRegistration, ModelRequest, ModelResponse, ModelStreamChunk } from '@jarvis/contracts';
export interface ProviderAdapter {
  readonly provider: string;
  generate(model: ModelRegistration, request: ModelRequest, signal: AbortSignal): Promise<ModelResponse>;
  stream?(model: ModelRegistration, request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelStreamChunk>;
  health(model: ModelRegistration, signal: AbortSignal): Promise<ModelHealth>;
}
