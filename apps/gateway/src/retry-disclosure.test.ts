import { afterAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { ModelGateway } from './gateway.ts';
import { ModelRegistry } from './registry.ts';
import { OpenAICompatibleAdapter } from './adapters/openai-compatible.ts';
import { ModelGatewayError, type ModelRequest } from '@jarvis/contracts';

/**
 * Retry-time disclosure protection, asserted by counting real HTTP requests.
 *
 * Two loopback providers, each counting what actually arrives. The claim under test is not "a flag
 * is set" but "the second provider received zero requests for a memory-bearing failure".
 */

interface Provider { server: Server; url: string; requests: number; fail: boolean }
const providers: Provider[] = [];

const makeProvider = async (fail: boolean): Promise<Provider> => {
  const state: Provider = { server: undefined as never, url: '', requests: 0, fail };
  state.server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', chunk => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      const path = request.url ?? '';
      if (!path.includes('/chat/completions')) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ object: 'list', data: [] }));
        return;
      }
      state.requests += 1;
      if (state.fail) {
        response.writeHead(503, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'provider unavailable' } }));
        return;
      }
      const proposal = {
        proposalId: 'p1', correlationId: 'corr-retry', confidence: 0.9, kind: 'answer', text: 'ok', citations: [],
        provenance: { method: 'model', producedBy: 'fixture', producedOn: 'fixture', producedAt: '2026-11-14T10:00:00.000Z', correlationId: 'corr-retry', derivedFromUntrusted: false },
      };
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        id: 'fixture', object: 'chat.completion', model: 'm',
        choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ proposals: [proposal], evidence: [] }) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        provenance: { producer: 'fixture', producedOn: 'fixture-host', producedAt: '2026-11-14T10:00:00.000Z', derivedFromUntrusted: false },
        routing: { phase: 'STARTING', selectedModelId: 'm', candidates: [] },
      }));
    });
  });
  await new Promise<void>(resolve => state.server.listen(0, '127.0.0.1', resolve));
  const address = state.server.address();
  state.url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  providers.push(state);
  return state;
};

const registration = (id: string, provider: string) => ({
  id, provider, displayName: id, tasks: ['reason'], capabilities: ['json'],
  contextLimitUnits: 100000, costPerContextUnit: 0, costPerOutputUnit: 0,
  locality: 'cloud-ok', enabled: true,
} as never);

const build = async (firstFails: boolean, secondFails: boolean) => {
  const first = await makeProvider(firstFails);
  const second = await makeProvider(secondFails);
  const registry = new ModelRegistry();
  registry.register(registration('fixture-a', 'fixture-a'), new OpenAICompatibleAdapter('fixture-a', `${first.url}/v1`, 'fixture-key'));
  registry.register(registration('fixture-b', 'fixture-b'), new OpenAICompatibleAdapter('fixture-b', `${second.url}/v1`, 'fixture-key'));
  return { gateway: new ModelGateway(registry), first, second };
};

const request = (disclosure?: 'personal-memory'): ModelRequest => ({
  task: 'reason', capabilities: ['json'],
  input: { instruction: 'hello', context: {}, constraints: [] },
  budget: { contextUnits: 10, maxOutput: 100 },
  locality: 'cloud-ok', correlationId: 'corr-retry',
  preferredModels: ['fixture-a', 'fixture-b'], preferredProviders: ['fixture-a', 'fixture-b'],
  ...(disclosure ? { disclosure } : {}),
} as never);

afterAll(async () => {
  for (const provider of providers) await new Promise<void>(resolve => provider.server.close(() => resolve()));
});

describe('retry and fallback behaviour, by outbound count', () => {
  it('falls back for an ordinary request', async () => {
    const { gateway, first, second } = await build(true, false);
    const response = await gateway.generate(request());
    expect(response.modelId).toBe('fixture-b');
    expect(first.requests).toBe(1);
    expect(second.requests).toBe(1);
  });

  it('succeeds once for a memory-bearing request when the first provider works', async () => {
    const { gateway, first, second } = await build(false, false);
    await gateway.generate(request('personal-memory'));
    expect(first.requests).toBe(1);
    expect(second.requests).toBe(0);
  });

  it('refuses the second provider for a memory-bearing failure', async () => {
    const { gateway, first, second } = await build(true, false);
    await expect(gateway.generate(request('personal-memory'))).rejects.toThrow(/retry refused/);
    expect(first.requests).toBe(1);
    expect(second.requests).toBe(0);
  });

  it('marks the refusal as non-retryable so no outer layer tries again', async () => {
    const { gateway } = await build(true, false);
    const error = await gateway.generate(request('personal-memory')).catch(caught => caught);
    expect(error).toBeInstanceOf(ModelGatewayError);
    expect((error as ModelGatewayError).retryable).toBe(false);
  });

  it('stops at one attempt when cancelled', async () => {
    const { gateway, first, second } = await build(true, false);
    const controller = new AbortController();
    controller.abort('CANCELLED');
    await expect(gateway.generate(request('personal-memory'), controller.signal)).rejects.toBeTruthy();
    expect(first.requests + second.requests).toBeLessThanOrEqual(1);
  });
});
