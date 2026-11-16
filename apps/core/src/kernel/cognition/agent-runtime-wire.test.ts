import { createServer, type Server } from 'node:http';
import { afterEach, expect, it } from 'vitest';
import { AgentRuntime } from './agent-runtime.ts';
import { HttpModelGatewayClient } from './model-client.ts';
import type { ModelRequest } from '@jarvis/contracts';

/**
 * Real sockets, not stub call counts.
 *
 * The previous evidence for "a protected request is never retransmitted" was an in-process counter on
 * a mocked gateway. That proves the branch, not the wire. These tests put a real HTTP server behind
 * the real client and count what actually arrives, including the disclosure marker that the client
 * emits, because a refused retransmission is worthless if the marker never left the process.
 */
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

const base: ModelRequest = {
  task: 'reason', capabilities: ['json'],
  input: { instruction: 'test', context: {} as never, constraints: [] },
  budget: { contextUnits: 10, maxOutput: 2048 },
  locality: 'local', principalId: 'p', correlationId: 'corr-1',
};

const provenance = { method: 'model', producedBy: 'fixture', producedOn: 'fixture-model', producedAt: new Date().toISOString(), correlationId: 'corr-1', derivedFromUntrusted: false };

/** A provider-shaped server that records every arrival and answers with `reply`. */
async function provider(reply: () => { status: number; body: unknown }): Promise<{ url: string; arrivals: { disclosure: string | undefined; maxTokens: number | undefined; path: string }[] }> {
  const arrivals: { disclosure: string | undefined; maxTokens: number | undefined; path: string }[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', chunk => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      const parsed = (() => { try { return JSON.parse(text) as { budget?: { maxOutput?: number } }; } catch { return {}; } })();
      arrivals.push({ disclosure: request.headers['x-jarvis-memory-disclosure'] as string | undefined, maxTokens: parsed.budget?.maxOutput, path: request.url ?? '' });
      const answer = reply();
      // The Kernel streams when it has a routing observer, so the fixture speaks both contracts.
      if ((request.url ?? '').endsWith('/v1/stream')) {
        response.writeHead(answer.status, { 'content-type': 'application/x-ndjson' });
        response.end('data: ' + JSON.stringify({ type: 'done', response: answer.body }) + String.fromCharCode(10,10));

        return;
      }
      response.writeHead(answer.status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(answer.body));
    });
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  return { url: `http://127.0.0.1:${address.port}`, arrivals };
}

const malformedBody = {
  modelId: 'fixture-model',
  output: { proposals: [{ proposalId: 'p1', kind: 'answer' }] },
  usage: { contextUnits: 1, outputUnits: 1, costEstimate: 0, latencyMs: 1, inputTokens: 5, outputTokens: 5 },
  finishReason: 'stop',
  provenance,
};

it('protected malformed output reaches a real provider exactly once and carries the marker', async () => {
  const { url, arrivals } = await provider(() => ({ status: 200, body: malformedBody }));
  const runtime = new AgentRuntime(new HttpModelGatewayClient(url, 'fixture-token'), () => new Date().toISOString());
  await expect(runtime.invoke('agents.oracle', { ...base, disclosure: 'personal-memory' })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  expect(arrivals).toHaveLength(1);
  expect(arrivals[0]?.disclosure).toBe('1');
});

it('unprotected malformed output is repaired: two real arrivals, both marked 0', async () => {
  const { url, arrivals } = await provider(() => ({ status: 200, body: malformedBody }));
  const runtime = new AgentRuntime(new HttpModelGatewayClient(url, 'fixture-token'), () => new Date().toISOString());
  await expect(runtime.invoke('agents.oracle', base)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  expect(arrivals).toHaveLength(2);
  expect(arrivals.every(arrival => arrival.disclosure === '0')).toBe(true);
});

it('a provider failure on a protected request is not retried on the wire', async () => {
  const { url, arrivals } = await provider(() => ({ status: 500, body: { error: 'provider down' } }));
  const runtime = new AgentRuntime(new HttpModelGatewayClient(url, 'fixture-token'), () => new Date().toISOString());
  await expect(runtime.invoke('agents.oracle', { ...base, disclosure: 'personal-memory' })).rejects.toBeTruthy();
  expect(arrivals).toHaveLength(1);
});

it('the requested output allowance is what arrives at the provider', async () => {
  const { url, arrivals } = await provider(() => ({ status: 200, body: { ...malformedBody, output: { proposals: [] } } }));
  const runtime = new AgentRuntime(new HttpModelGatewayClient(url, 'fixture-token'), () => new Date().toISOString());
  await runtime.invoke('agents.oracle', { ...base, budget: { contextUnits: 10, maxOutput: 6144 } });
  expect(arrivals[0]?.maxTokens).toBe(6144);
});
