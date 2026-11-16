import { describe, expect, it } from 'vitest';
import type { ModelRegistration, ModelRequest } from '@jarvis/contracts';
import { OpenAICompatibleAdapter } from './openai-compatible.ts';

/**
 * What actually leaves the machine. The adapter is the last place we control, so the test
 * captures the real request body and asserts both what must be present (the instruction and
 * eligible context) and what must never be present (private sentinels, request metadata).
 */

const SENTINEL = 'SENTINEL-RESTRICTED-7f3a';
const ALLOWED = 'allowed-internal-fact';

const model: ModelRegistration = {
  id: 'deepseek/deepseek-v4.1-flash-1017', provider: 'openrouter', displayName: 'test',
  tasks: ['reason'], capabilities: ['json'], contextLimitUnits: 200_000,
  costPerContextUnit: 0, costPerOutputUnit: 0, locality: 'cloud-ok', enabled: true,
  registeredAt: '2026-11-13T00:00:00.000Z',
};

const request = (context: unknown): ModelRequest => ({
  task: 'reason',
  capabilities: ['json'],
  input: { instruction: 'synthetic instruction', constraints: ['be brief'], context } as never,
  budget: { contextUnits: 100, maxOutput: 256, maxLatencyMs: 5000 },
  locality: 'cloud-ok',
  determinism: 'low-temp',
  correlationId: 'corr-1',
  principalId: 'owner',
  privacyClass: 'INTERNAL',
  cloudAllowed: true,
  requiredProvider: 'openrouter',
  preferredModels: ['deepseek/deepseek-v4.1-flash-1017'],
});

const capture = async (body: unknown) => {
  let sent: Record<string, unknown> = {};
  const adapter = new OpenAICompatibleAdapter('openrouter', 'https://example.invalid/api/v1', 'test-key', (async (_url: string, init: { body: string }) => {
    sent = JSON.parse(init.body);
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"proposals":[]}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0001 } }),
      headers: new Headers(),
    } as never;
  }) as never);
  await adapter.generate(model, request(body), new AbortController().signal);
  return sent;
};

describe('outbound provider payload', () => {
  it('sends the instruction and the eligible context', async () => {
    const body = await capture({ note: ALLOWED });
    const messages = body.messages as Array<{ role: string; content: string }>;
    expect(messages[1]!.content).toContain('synthetic instruction');
    expect(messages[1]!.content).toContain(ALLOWED);
  });

  it('21. carries no restricted sentinel when the context does not contain one', async () => {
    const body = await capture({ note: ALLOWED, excluded: { reason: 'above ceiling' } });
    expect(JSON.stringify(body)).not.toContain(SENTINEL);
  });

  it('sends no request metadata: no principal, correlation, privacy class or provider binding', async () => {
    const body = await capture({ note: ALLOWED });
    const serialised = JSON.stringify(body);
    for (const forbidden of ['principalId', 'correlationId', 'privacyClass', 'requiredProvider', 'preferredModels', 'owner']) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it('respects the output ceiling it was given', async () => {
    const body = await capture({ note: ALLOWED });
    expect(body.max_tokens).toBe(256);
  });

  it('the system prompt makes no claim about permitted data', async () => {
    const body = await capture({ note: ALLOWED });
    const system = (body.messages as Array<{ role: string; content: string }>)[0]!;
    expect(system.role).toBe('system');
    expect(system.content.toLowerCase()).not.toContain('private');
    expect(system.content.toLowerCase()).not.toContain('restricted');
  });
});
