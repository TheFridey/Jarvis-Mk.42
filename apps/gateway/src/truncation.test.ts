import { createServer, type Server } from 'node:http';
import { afterEach, expect, it } from 'vitest';
import { OpenAICompatibleAdapter } from './adapters/openai-compatible.ts';

/**
 * Truncation is classified by the adapter, not the Gateway: a provider that stops on `length` has
 * produced a fragment, and the fragment must become INVALID_RESPONSE rather than a plausible answer.
 * Counted on a real socket, because "it throws" says nothing about how many times it asked.
 */
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

async function openAiProvider(finishReason: string): Promise<{ baseUrl: string; arrivals: number[] }> {
  const arrivals: number[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', chunk => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      arrivals.push(chunks.length);
      const text = Buffer.concat(chunks).toString('utf8');
      const model = (() => { try { return (JSON.parse(text) as { model?: string }).model ?? 'fixture-model'; } catch { return 'fixture-model'; } })();
      const payload = {
        id: 'fixture', object: 'chat.completion', model,
        choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ proposals: [], evidence: [] }) }, finish_reason: finishReason }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(payload));
    });
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return { baseUrl: `http://127.0.0.1:${port}/v1`, arrivals };
}

const request = {
  task: 'reason', capabilities: ['json'],
  input: { instruction: 'hello', context: {}, constraints: [] },
  budget: { contextUnits: 10, maxOutput: 2048 },
  locality: 'cloud-ok', correlationId: 'corr-truncation',
  preferredModels: ['fixture'], preferredProviders: ['fixture'],
  disclosure: 'personal-memory',
} as never;

it('a truncated answer becomes INVALID_RESPONSE after exactly one provider arrival', async () => {
  const { baseUrl, arrivals } = await openAiProvider('length');
  const adapter = new OpenAICompatibleAdapter('fixture', baseUrl, 'fixture-key');
  await expect(adapter.generate({ id: 'fixture', provider: 'fixture', capabilities: [], limits: { contextUnits: 100000, outputUnits: 8192 } } as never, request, new AbortController().signal)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  expect(arrivals).toHaveLength(1);
});

it('a complete answer is accepted in one arrival', async () => {
  const { baseUrl, arrivals } = await openAiProvider('stop');
  const adapter = new OpenAICompatibleAdapter('fixture', baseUrl, 'fixture-key');
  const response = await adapter.generate({ id: 'fixture', provider: 'fixture', capabilities: [], limits: { contextUnits: 100000, outputUnits: 8192 } } as never, request, new AbortController().signal);
  expect(response.finishReason).toBe('stop');
  expect(arrivals).toHaveLength(1);
});
