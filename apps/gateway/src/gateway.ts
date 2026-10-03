import { ModelGatewayError, type ModelHealth, type ModelRequest, type ModelResponse, type ModelRoutingObservability, type ModelStreamChunk } from '@jarvis/contracts';
import { ModelRegistry } from './registry.ts';
import { withSpan, exportGauges } from '@jarvis/telemetry';
export class ModelGateway {
  private estimatedCost=0;
  constructor(readonly registry: ModelRegistry) {}
  inspect(request: ModelRequest): ModelRoutingObservability {
    const evaluation = this.registry.evaluate(request);
    return { schemaVersion: 1, phase: 'CANDIDATE', correlationId: request.correlationId, taskClass: request.task, privacyClass: request.privacyClass ?? 'INTERNAL', startedAt: new Date().toISOString(), candidates: evaluation.candidates, fallbackModelIds: evaluation.eligible.slice(1).map(entry => entry.model.id) };
  }
  async generate(request: ModelRequest, signal?: AbortSignal, onRouting?: (routing: ModelRoutingObservability) => Promise<void>): Promise<ModelResponse> {
    const routing = this.inspect(request);
    const candidates = routing.candidates.filter(candidate => candidate.state === 'CANDIDATE').sort((a, b) => a.score! - b.score!);
    await onRouting?.({ ...routing });
    if (!candidates.length) throw new ModelGatewayError('NO_ROUTE', 'no model satisfies routing constraints', false);
    const failed: string[] = [];
    for (const candidate of candidates) {
      const selected = this.registry.get(candidate.modelId)!;
      const timeout = AbortSignal.timeout(request.budget.maxLatencyMs ?? 120_000);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      routing.phase = failed.length ? 'FALLBACK' : 'STARTING';
      routing.selectedModelId = selected.model.id; routing.selectionReason = candidate.reason;
      routing.candidates = routing.candidates.map(item => ({ ...item, ...(failed.includes(item.modelId)?{reason:'provider attempt failed; fallback continued'}:{}), state: failed.includes(item.modelId) ? 'FAILED' : item.modelId === selected.model.id ? failed.length ? 'FALLBACK' : 'SELECTED' : item.state }));
      if (failed.length) routing.fallbackReason = `${failed.join(', ')} failed before selection`;
      // Persistence/observation failures must propagate, never trigger provider fallback.
      await onRouting?.({ ...routing, candidates: routing.candidates.map(item => ({ ...item })) });
      let response: ModelResponse;
      try {
        response = await withSpan('model.provider.request', { 'jarvis.correlation_id': request.correlationId, 'jarvis.model.id': selected.model.id, 'jarvis.model.provider': selected.adapter.provider }, () => selected.adapter.generate(selected.model, request, combined));
      } catch (error) {
        selected.breaker.failure(); failed.push(selected.model.id);
        const last = combined.aborted ? new ModelGatewayError(signal?.aborted ? 'CANCELLED' : 'TIMEOUT', 'model request cancelled or timed out', true, selected.adapter.provider) : error;
        if (combined.aborted || (last instanceof ModelGatewayError && !last.retryable) || failed.length === candidates.length) {
          routing.phase = 'FAILED'; routing.errorClass = last instanceof ModelGatewayError ? last.code : 'PROVIDER_ERROR'; routing.completedAt = new Date().toISOString();
          routing.candidates = routing.candidates.map(item => failed.includes(item.modelId) ? { ...item, state: 'FAILED', reason: 'provider attempt failed' } : item);
          await onRouting?.({ ...routing });
          throw new ModelGatewayError(routing.errorClass, 'model provider request failed', last instanceof ModelGatewayError ? last.retryable : true);
        }
        continue;
      }
      if(Number.isFinite(response.usage.costEstimate)){this.estimatedCost+=response.usage.costEstimate;void exportGauges({jarvis_gateway_cost_estimate:this.estimatedCost});}
      selected.breaker.success(); selected.observedLatencyMs = response.usage.latencyMs;
      routing.phase = 'COMPLETE'; routing.completedAt = new Date().toISOString();
      await onRouting?.({ ...routing });
      return { ...response, routing };
    }
    throw new ModelGatewayError('PROVIDER_ERROR', 'all model providers unavailable', true);
  }
  async *stream(request: ModelRequest, signal?: AbortSignal): AsyncIterable<ModelStreamChunk> {
    const selected = this.registry.route(request);
    if (!selected?.adapter.stream) { yield { type: 'done', response: await this.generate(request, signal) }; return; }
    const timeout = AbortSignal.timeout(request.budget.maxLatencyMs ?? 120_000);
    yield* selected.adapter.stream(selected.model, request, signal ? AbortSignal.any([signal, timeout]) : timeout);
  }
  async health(): Promise<ModelHealth[]> {
    const result = await Promise.all(this.registry.all().map(async entry => {
      if (entry.breaker.open) return { modelId: entry.model.id, provider: entry.model.provider, status: 'circuit-open', checkedAt: new Date().toISOString() } as ModelHealth;
      try { const result = await entry.adapter.health(entry.model, AbortSignal.timeout(3000)); entry.healthy = result.status === 'healthy' || result.status === 'degraded'; entry.observedHealth = result.status === 'circuit-open' ? 'offline' : result.status; return result; }
      catch { entry.healthy = false; entry.observedHealth = 'offline'; return { modelId: entry.model.id, provider: entry.model.provider, status: 'offline', checkedAt: new Date().toISOString(), detail: 'health probe failed' } as ModelHealth; }
    }));
    void exportGauges({jarvis_gateway_models:result.length,jarvis_gateway_provider_healthy:result.filter(m=>m.status==='healthy').length,jarvis_gateway_circuit_open:result.filter(m=>m.status==='circuit-open').length,jarvis_gateway_provider_offline:result.filter(m=>m.status==='offline').length});
    return result;
  }
}
