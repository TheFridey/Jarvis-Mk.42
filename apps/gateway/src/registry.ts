import type { ModelRegistration, ModelRequest } from '@jarvis/contracts';
import type { ProviderAdapter } from './provider.ts';
import { CircuitBreaker } from './circuit-breaker.ts';
export interface RegisteredModel { model: ModelRegistration; adapter: ProviderAdapter; breaker: CircuitBreaker; healthy: boolean; observedLatencyMs?: number; }
export class ModelRegistry {
  private readonly models = new Map<string, RegisteredModel>();
  register(model: ModelRegistration, adapter: ProviderAdapter) { if (model.provider !== adapter.provider) throw new Error('provider mismatch'); this.models.set(model.id, { model, adapter, breaker: new CircuitBreaker(), healthy: true }); }
  get(id: string) { return this.models.get(id); }
  all() { return [...this.models.values()]; }
  route(request: ModelRequest): RegisteredModel | undefined {
    const privacyCloudDenied = ['SENSITIVE', 'RESTRICTED'].includes(request.privacyClass ?? 'INTERNAL');
    const candidates = this.all().filter(({ model, breaker, healthy }) => model.enabled && healthy && breaker.canAttempt() && model.tasks.includes(request.task) && request.capabilities.every((cap) => model.capabilities.includes(cap)) && model.contextLimitUnits >= request.budget.contextUnits && !(request.locality === 'local' && model.locality !== 'local') && !(privacyCloudDenied && model.locality !== 'local') && !(request.budget.maxCost !== undefined && this.estimatedCost(model, request) > request.budget.maxCost) && !(request.budget.maxLatencyMs !== undefined && (this.models.get(model.id)?.observedLatencyMs ?? 0) > request.budget.maxLatencyMs));
    return candidates.sort((a,b) => this.score(a, request) - this.score(b, request))[0];
  }
  private estimatedCost(model: ModelRegistration, request: ModelRequest) { return model.costPerContextUnit * request.budget.contextUnits + model.costPerOutputUnit * request.budget.maxOutput; }
  private score(entry: RegisteredModel, request: ModelRequest) { const preferred = request.preferredModels?.indexOf(entry.model.id) ?? -1; return (preferred >= 0 ? preferred * -1000 : 0) + (request.locality === 'prefer-local' && entry.model.locality === 'local' ? -500 : 0) + (entry.observedLatencyMs ?? 1000) + this.estimatedCost(entry.model, request) * 100; }
}
