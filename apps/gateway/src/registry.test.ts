import { describe, expect, it } from 'vitest';
import type { ModelRegistration, ModelRequest } from '@jarvis/contracts';
import { ModelRegistry } from './registry.ts';

/**
 * Provider binding is a security property, not a preference: an explicitly authorised
 * conversation names one provider, and no other provider may serve the request.
 */

const model = (id: string, provider: string, locality: 'cloud-ok' | 'local' = 'cloud-ok'): ModelRegistration => ({
  id, provider, displayName: id, tasks: ['reason'], capabilities: ['json'],
  contextLimitUnits: 200_000, costPerContextUnit: 0, costPerOutputUnit: 0,
  locality, enabled: true, registeredAt: '2026-11-13T00:00:00.000Z',
});

const adapter = (provider: string) => ({
  provider,
  generate: async () => { throw new Error('not called'); },
  health: async () => ({ modelId: 'x', provider, status: 'healthy' as const, checkedAt: '2026-11-13T00:00:00.000Z' }),
  stream: async function* () { /* unused */ },
}) as never;

const registry = () => {
  const registry = new ModelRegistry();
  for (const registration of [model('openrouter-model', 'openrouter'), model('other-model', 'anthropic')]) {
    registry.register(registration, adapter(registration.provider));
  }
  return registry;
};

const request = (patch: Partial<ModelRequest> = {}): ModelRequest => ({
  task: 'reason', capabilities: ['json'], input: { instruction: 'synthetic', context: {} } as never,
  budget: { contextUnits: 100, maxOutput: 256 }, locality: 'cloud-ok',
  correlationId: 'c', principalId: 'p', cloudAllowed: true, privacyClass: 'INTERNAL',
  preferredModels: ['openrouter-model', 'other-model'], ...patch,
});

describe('registry provider binding', () => {
  it('serves only the bound provider', () => {
    expect(registry().route(request({ requiredProvider: 'openrouter' }))?.model.provider).toBe('openrouter');
    expect(registry().route(request({ requiredProvider: 'anthropic' }))?.model.provider).toBe('anthropic');
  });

  it('refuses rather than substituting when the bound provider has no eligible model', () => {
    expect(() => registry().route(request({ requiredProvider: 'gone-provider' }))).toThrowError(/not authorised|no eligible model/);
  });

  it('fails closed instead of falling back to a healthy model from another provider', () => {
    const reg = registry();
    // The bound provider's model cannot serve this task; the other provider can.
    reg.get('openrouter-model')!.model.tasks = ['code'];
    expect(() => reg.route(request({ requiredProvider: 'openrouter' }))).toThrow();
  });

  it('leaves unbound routing untouched', () => {
    expect(registry().route(request())?.model.id).toBe('openrouter-model');
  });

  it('still refuses cloud models for a sensitive context even with a binding', () => {
    const reg = registry();
    reg.register(model('local-model', 'local-openai-compatible', 'local'), adapter('local-openai-compatible'));
    expect(() => reg.route(request({ privacyClass: 'SENSITIVE', requiredProvider: 'openrouter' }))).toThrow();
  });

  it('a circuit-broken provider is not silently replaced', () => {
    const reg = new ModelRegistry();
    reg.register(model('openrouter-model', 'openrouter'), adapter('openrouter'));
    reg.register(model('other-model', 'anthropic'), adapter('anthropic'));
    reg.get('openrouter-model')!.healthy = false;
    expect(() => reg.route(request({ requiredProvider: 'openrouter' }))).toThrow();
    expect(reg.route(request())?.model.provider).toBe('anthropic');
  });
});
