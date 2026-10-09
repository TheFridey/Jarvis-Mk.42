import { createServer, type Server } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import { cloudSpeech } from './cloud-speech.ts';

let server: Server | undefined;
afterEach(async () => { vi.unstubAllEnvs(); if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined; } });
it('uses the authenticated Gateway with consent, bounded text and no provider credential', async () => {
  vi.stubEnv('OPENAI_API_KEY', ''); vi.stubEnv('JARVIS_GATEWAY_TOKEN', 'test-gateway');
  let input: unknown; let authorization: string | undefined; let path: string | undefined;
  server = createServer(async (req, res) => {
    path = req.url; authorization = req.headers.authorization; const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    input = JSON.parse(Buffer.concat(chunks).toString()); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ audio: 'AAAA' }));
  });
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing address');
  vi.stubEnv('JARVIS_MODEL_GATEWAY_URL', `http://127.0.0.1:${address.port}`);
  expect(await cloudSpeech({ operation: 'synthesize', text: 'x'.repeat(5000) }, new AbortController().signal)).toEqual({ audio: 'AAAA' });
  expect(path).toBe('/v1/speech'); expect(authorization).toBe('Bearer test-gateway');
  expect(input).toEqual({ operation: 'synthesize', text: 'x'.repeat(4096), cloudConsent: true });
});
