import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { writeFileSync } from 'node:fs';
import { AgentRuntime } from '../cognition/agent-runtime.ts';
import { HttpModelGatewayClient } from '../cognition/model-client.ts';
import { CognitionOrchestrator } from '../cognition/cognition-orchestrator.ts';
import { composeMemoryContext, type MemoryRecord } from './personal-memory.ts';

/**
 * The outbound boundary — real HTTP.
 *
 * Chain under test: CognitionOrchestrator → AgentRuntime (real manifests, real prompt assembly)
 * → HttpModelGatewayClient (real fetch) → a local fixture endpoint that records the body.
 * The only fiction is the server: no provider is contacted and nothing is spent.
 *
 * The capture is the wire body, not a runtime.invoke argument. If the memory text is not in
 * `captured.body`, it did not leave the machine.
 */

const PRINCIPAL = 'principal-a';
let server: Server;
let baseUrl = '';
const captured: { path: string; authorization: string; body: string }[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', chunk => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      captured.push({ path: request.url ?? '', authorization: String(request.headers.authorization ?? ''), body: Buffer.concat(chunks).toString('utf8') });
      const proposal = {
        proposalId: 'p1', correlationId: 'corr', confidence: 0.9, kind: 'answer', text: 'Noted.', citations: [],
        provenance: { method: 'model', producedBy: 'fixture', producedOn: 'fixture', producedAt: '2026-11-13T10:00:00.000Z', correlationId: 'corr', derivedFromUntrusted: false },
      };
      const payload = {
        modelId: 'fixture-model',
        usage: { inputTokens: 10, outputTokens: 5, cost: 0 },
        routing: { phase: 'direct', selectedModelId: 'fixture-model', candidates: [] },
        provenance: { producer: 'fixture-gateway', producedOn: 'fixture-host', producedAt: '2026-11-13T10:00:00.000Z', derivedFromUntrusted: false },
        output: { proposals: [proposal], evidence: [] },
      };
      // The real client streams when a routing callback is supplied, so the fixture speaks SSE
      // on /v1/stream and plain JSON on /v1/generate — the same two shapes the gateway serves.
      if ((request.url ?? '').includes('/v1/stream')) {
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.end([
          `data: ${JSON.stringify({ type: 'routing', routing: payload.routing })}`,
          '',
          `data: ${JSON.stringify({ type: 'done', response: payload })}`,
          '', '',
        ].join(String.fromCharCode(10)));
      } else {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(payload));
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });

const record = (over: Partial<MemoryRecord>): MemoryRecord => ({
  id: 'm1', principalId: PRINCIPAL, category: 'communication', subject: 'response-length-preference',
  statement: 'Prefers concise technical summaries unless a full report is requested.',
  source: 'synthetic', confidence: 0.9, privacyClass: 'INTERNAL', cloudEligible: true,
  reviewStatus: 'approved', recordedAt: '2026-11-01T00:00:00.000Z', ...over,
});

const orchestrator = (verify?: () => Promise<{ ok: boolean; reason?: string }>) => new CognitionOrchestrator({
  sql: (async (strings: TemplateStringsArray) => (/^insert into cognition\.runs/i.test(String(strings[0]).trim()) ? [{ request_id: 'fixture-run' }] : [])) as never,
  context: {
    compile: async () => ({ id: 'ctx-fixture', budget: { usedUnits: 10, limitUnits: 4000 }, maxPrivacyClass: 'INTERNAL', sections: [] }),
  } as never,
  runtime: new AgentRuntime(new HttpModelGatewayClient(baseUrl, 'fixture-token'), () => '2026-11-13T10:00:00.000Z'),
  agency: { ingest: async () => ({ accepted: [] }) } as never,
  events: { emit: async () => undefined } as never,
  now: () => '2026-11-13T10:00:00.000Z',
  cloudAllowed: true,
  // A grant verifier always exists in production; the fixture approves by default and refuses
  // when a case says so.
  verifyAuthorisation: verify ?? (async () => ({ ok: true })),
});

async function send(text: string, options: { memory?: MemoryRecord[]; verify?: () => Promise<{ ok: boolean; reason?: string }> } = {}) {
  captured.length = 0;
  const block = options.memory ? composeMemoryContext(options.memory, { query: text, principalId: PRINCIPAL, locality: 'cloud' }) : '';
  await orchestrator(options.verify).submit({
    requestId: `req_${Math.random().toString(36).slice(2)}`,
    principalId: PRINCIPAL, correlationId: 'corr', input: text + block,
    agentId: 'agents.oracle', task: 'reason',
    locality: 'cloud-ok', cloudAllowed: true, privacyClass: 'INTERNAL',
    // Present so the dispatch-time grant verifier runs at all.
    authorisation: { grantId: 'grant-fixture', conversationId: 'conv-fixture', provider: 'fixture-provider' },
  } as never);
  return captured.at(-1);
}

describe('memory at the HTTP boundary', () => {
  const query = 'How detailed should your technical answers be for me?';

  const evidence = (name: string, body: string) => {
    const path = process.env.JARVIS_WIRE_EVIDENCE;
    if (!path) return;
    writeFileSync(path, JSON.stringify({
      boundary: 'http-body captured at the Model Gateway client',
      case: name,
      transport: 'POST /v1/stream (SSE), authorization header redacted',
      bodyBytes: Buffer.byteLength(body),
      containsEligibleMemory: body.includes('response-length-preference'),
      containsDeletedMarker: body.includes('[deleted by owner]'),
      containsOtherPrincipal: body.includes('invoice numbering'),
      containsMemoryBlockHeader: body.includes('Approved context about the owner'),
      // Never the full body: it is fixture text, but the habit matters.
      excerpt: body.slice(0, 240),
    }, null, 2));
  };

  it('puts an approved INTERNAL cloud-eligible memory in an authorised request body', async () => {
    const payload = await send(query, { memory: [record({})] });
    expect(payload?.path).toMatch(/\/v1\/(stream|generate)/);
    expect(payload?.authorization).toContain('fixture-token');
    expect(payload?.body).toContain('response-length-preference');
    expect(payload?.body).toContain('concise technical summaries');
    evidence('eligible-memory-present', payload?.body ?? '');
  });

  it('omits local-only, SENSITIVE, RESTRICTED, revoked, deleted, superseded, other-principal and irrelevant records', async () => {
    const payload = await send(query, {
      memory: [
        record({ id: 'local-only', cloudEligible: false }),
        record({ id: 'sensitive', privacyClass: 'SENSITIVE' }),
        record({ id: 'restricted', privacyClass: 'RESTRICTED', cloudEligible: true }),
        record({ id: 'revoked', revokedAt: '2026-11-10T00:00:00.000Z' }),
        record({ id: 'deleted', statement: '[deleted by owner]', revokedAt: '2026-11-10T00:00:00.000Z' }),
        record({ id: 'superseded', supersededBy: 'newer' }),
        record({ id: 'other', principalId: 'principal-b' }),
        record({ id: 'irrelevant', category: 'business', subject: 'invoice numbering', statement: 'Invoices start at 1001.' }),
      ],
    });
    expect(payload?.body).not.toContain('[deleted by owner]');
    expect(payload?.body).not.toContain('Invoices start at 1001');
    expect(payload?.body).not.toContain('Approved context about the owner');
  });

  it('sends no memory for a greeting', async () => {
    const payload = await send('Evening Jarvis.', { memory: [record({ subject: 'financial-independence', category: 'ambition', statement: 'Wants independence from single clients.' })] });
    expect(payload?.body).not.toContain('financial-independence');
    expect(payload?.body).not.toContain('Approved context about the owner');
  });

  it('refuses to dispatch when the grant verifier says no', async () => {
    await expect(send(query, { memory: [record({})], verify: async () => ({ ok: false, reason: 'grant revoked' }) }))
      .rejects.toThrow(/authorisation refused before dispatch/);
    expect(captured).toHaveLength(0);
  });

  it('excludes a memory revoked after selection but before dispatch', async () => {
    const selected = [record({})];
    expect(composeMemoryContext(selected, { query, principalId: PRINCIPAL, locality: 'cloud' })).toContain('concise technical summaries');
    const revoked = selected.map(entry => ({ ...entry, revokedAt: '2026-11-13T09:59:59.000Z' }));
    expect(composeMemoryContext(revoked, { query, principalId: PRINCIPAL, locality: 'cloud' })).toBe('');
    const payload = await send(query, { memory: revoked });
    expect(payload?.body).not.toContain('concise technical summaries');
  });
});
