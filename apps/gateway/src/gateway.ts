import { ModelGatewayError, type ModelHealth, type ModelRequest, type ModelResponse, type ModelStreamChunk } from '@jarvis/contracts';
import { ModelRegistry } from './registry.ts';
export class ModelGateway {
  constructor(readonly registry: ModelRegistry) {}
  async generate(request: ModelRequest, signal?: AbortSignal): Promise<ModelResponse> {
    const selected = this.registry.route(request); if (!selected) throw new ModelGatewayError('NO_ROUTE', 'no model satisfies capability, locality, privacy and budget constraints', false);
    const timeout = AbortSignal.timeout(request.budget.maxLatencyMs ?? 120_000); const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try { const response = await selected.adapter.generate(selected.model, request, combined); selected.breaker.success(); selected.observedLatencyMs = response.usage.latencyMs; return response; }
    catch (error) { selected.breaker.failure(); if (combined.aborted) throw new ModelGatewayError(signal?.aborted ? 'CANCELLED' : 'TIMEOUT', 'model request cancelled or timed out', true, selected.adapter.provider); if (error instanceof ModelGatewayError) throw error; throw new ModelGatewayError('PROVIDER_ERROR', error instanceof Error ? error.message : String(error), true, selected.adapter.provider); }
  }
  async *stream(request: ModelRequest, signal?: AbortSignal): AsyncIterable<ModelStreamChunk> { const selected = this.registry.route(request); if (!selected?.adapter.stream) { const response = await this.generate(request, signal); yield { type: 'done', response }; return; } const timeout = AbortSignal.timeout(request.budget.maxLatencyMs ?? 120_000); yield* selected.adapter.stream(selected.model, request, signal ? AbortSignal.any([signal, timeout]) : timeout); }
  async health(): Promise<ModelHealth[]> { return Promise.all(this.registry.all().map(async (entry) => { if (entry.breaker.open) return { modelId: entry.model.id, provider: entry.model.provider, status: 'circuit-open', checkedAt: new Date().toISOString() } as ModelHealth; try { const result = await entry.adapter.health(entry.model, AbortSignal.timeout(3000)); entry.healthy = result.status === 'healthy' || result.status === 'degraded'; return result; } catch (error) { entry.healthy = false; return { modelId: entry.model.id, provider: entry.model.provider, status: 'offline', checkedAt: new Date().toISOString(), detail: error instanceof Error ? error.message : String(error) }; } })); }
}
