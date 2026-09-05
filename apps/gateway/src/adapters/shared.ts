import { ModelGatewayError, type ModelRegistration, type ModelRequest, type ModelResponse } from '@jarvis/contracts';

export type Fetch = typeof fetch;
export function prompt(request: ModelRequest): string {
  return JSON.stringify({ instruction: request.input.instruction, constraints: request.input.constraints, context: request.input.context, examples: request.input.examples ?? [] });
}
export function httpError(provider: string, status: number, body: string): ModelGatewayError {
  if (status === 401 || status === 403) return new ModelGatewayError('AUTHENTICATION', `${provider} authentication failed`, false, provider);
  if (status === 429) return new ModelGatewayError('RATE_LIMITED', `${provider} rate limited`, true, provider);
  return new ModelGatewayError(status >= 500 ? 'UNAVAILABLE' : 'PROVIDER_ERROR', `${provider} HTTP ${status}: ${body.slice(0, 200)}`, status >= 500, provider);
}
export function response(model: ModelRegistration, output: unknown, input: number, out: number, latencyMs: number): ModelResponse {
  return { modelId: model.id, output, usage: { contextUnits: input, outputUnits: out, costEstimate: input * model.costPerContextUnit + out * model.costPerOutputUnit, latencyMs }, finishReason: 'stop', provenance: { method: 'model', producedBy: model.id, producedOn: model.provider, producedAt: new Date().toISOString(), correlationId: 'model-gateway', derivedFromUntrusted: true } };
}
export function parseOutput(value: unknown): unknown { if (typeof value !== 'string') return value; try { return JSON.parse(value); } catch { return value; } }
