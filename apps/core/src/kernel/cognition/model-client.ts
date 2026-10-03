import { ModelGatewayError, type ModelHealth, type ModelRequest, type ModelResponse, type ModelRoutingObservability, type ModelStreamChunk } from '@jarvis/contracts';
import { injectTraceHeaders, withSpan } from '@jarvis/telemetry';
export interface ModelGatewayPort { generate(request: ModelRequest, signal?: AbortSignal, onRouting?: (routing: ModelRoutingObservability) => Promise<void>): Promise<ModelResponse>; health?(): Promise<ModelHealth[]>; }
export class HttpModelGatewayClient implements ModelGatewayPort {
  constructor(private readonly baseUrl: string, private readonly token: string) {}
  async generate(request: ModelRequest, signal?: AbortSignal, onRouting?: (routing: ModelRoutingObservability) => Promise<void>): Promise<ModelResponse> {
    return withSpan('model_gateway.request', { 'jarvis.correlation_id': request.correlationId, 'jarvis.model.task': request.task }, async () => {
      const res = await fetch(`${this.baseUrl}${onRouting ? '/v1/stream' : '/v1/generate'}`, { method: 'POST', signal, headers: injectTraceHeaders({ 'content-type': 'application/json', authorization: `Bearer ${this.token}` }), body: JSON.stringify(request) });
      if (!res.ok) throw new ModelGatewayError('UNAVAILABLE', `gateway HTTP ${res.status}`, res.status >= 500);
      if (!onRouting) return await res.json() as ModelResponse;
      if (!res.body) throw new ModelGatewayError('INVALID_RESPONSE', 'gateway stream missing', false);
      const reader = res.body.getReader(), decoder = new TextDecoder();
      let buffer = '', response: ModelResponse | undefined;
      try {
        while (true) {
          const read = await reader.read(); if (read.done) break;
          buffer += decoder.decode(read.value, { stream: true });
          if (buffer.length > 2_000_000) throw new ModelGatewayError('INVALID_RESPONSE', 'gateway stream frame too large', false);
          let boundary: number;
          while ((boundary = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
            if (!frame.startsWith('data: ')) continue;
            const chunk = JSON.parse(frame.slice(6)) as ModelStreamChunk;
            if (chunk.type === 'routing' && chunk.routing) await onRouting(chunk.routing);
            if (chunk.type === 'done') response = chunk.response;
            if (chunk.type === 'error') throw new ModelGatewayError(chunk.error?.code ?? 'PROVIDER_ERROR', 'gateway model request failed', chunk.error?.retryable ?? false);
          }
        }
      } finally { await reader.cancel(); reader.releaseLock(); }
      if (!response) throw new ModelGatewayError('INVALID_RESPONSE', 'gateway disconnected without result', true);
      return response;
    });
  }
  async health(): Promise<ModelHealth[]> { const res = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(3000) }); if (!res.ok) return []; return ((await res.json()) as { models: ModelHealth[] }).models; }
}
