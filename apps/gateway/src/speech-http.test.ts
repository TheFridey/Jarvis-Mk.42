import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { speechHttp } from './speech-http.ts';

let server: Server | undefined;
afterEach(async () => { if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined; } });
async function start(provider = vi.fn(async () => ({ audio: 'AAAA' }))) {
  server = createServer((req, res) => { void speechHttp(req, res, 'test-token', provider); });
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing address');
  const url = `http://127.0.0.1:${address.port}/v1/speech`;
  const post = (body: unknown, token = 'test-token') => fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { post, provider, url };
}
describe('Gateway speech HTTP boundary', () => {
  it('rejects unauthorized audio before invoking the provider', async () => {
    const { post, provider } = await start();
    expect((await post({ operation: 'recognize', audio: 'AAAA', cloudConsent: true }, 'wrong')).status).toBe(401);
    expect(provider).not.toHaveBeenCalled();
  });
  it.each([undefined, false, 'true'])('requires explicit audio consent (%s)', async cloudConsent => {
    const { post, provider } = await start();
    expect((await post({ operation: 'recognize', audio: 'AAAA', cloudConsent })).status).toBe(403);
    expect(provider).not.toHaveBeenCalled();
  });
  it.each([
    { operation: 'recognize', audio: 'not base64!' },
    { operation: 'synthesize', text: 'x'.repeat(4097) },
    { operation: 'unknown', text: 'hello' },
    { operation: 'synthesize', text: 'hello', provider: 'override' },
  ])('rejects malformed or oversized operations', async input => {
    const { post, provider } = await start();
    expect((await post({ ...input, cloudConsent: true })).status).toBe(400);
    expect(provider).not.toHaveBeenCalled();
  });
  it('returns provider-neutral audio over the authenticated transport', async () => {
    const { post, provider } = await start(); const input = { operation: 'synthesize', text: 'hello', cloudConsent: true };
    expect(await (await post(input)).json()).toEqual({ audio: 'AAAA' });
    expect(provider).toHaveBeenCalledWith(input, expect.any(AbortSignal));
  });
  it('accepts a full twelve-second PCM WAV utterance within the audio budget', async () => {
    const { post, provider } = await start();
    const audio = Buffer.alloc(16000 * 2 * 12 + 44).toString('base64');
    expect((await post({ operation: 'recognize', audio, cloudConsent: true })).status).toBe(200);
    expect(provider).toHaveBeenCalledWith({ operation: 'recognize', audio, cloudConsent: true }, expect.any(AbortSignal));
  });
  it('rejects malformed JSON and oversized bodies before provider work', async () => {
    const { url, provider } = await start();
    for (const [body, status] of [['{', 400], [JSON.stringify({ cloudConsent: true, text: 'x'.repeat(2_000_000) }), 413]] as const) {
      const response = await fetch(url, { method: 'POST', headers: { authorization: 'Bearer test-token' }, body });
      expect(response.status).toBe(status);
    }
    expect(provider).not.toHaveBeenCalled();
  });
  it('redacts provider errors', async () => {
    const { post } = await start(vi.fn(async () => { throw new Error('secret provider response'); }));
    const response = await post({ operation: 'synthesize', text: 'hello', cloudConsent: true });
    expect(response.status).toBe(502); expect(await response.json()).toEqual({ error: 'cloud_speech_unavailable' });
  });
  it('cancels provider work when the caller disconnects', async () => {
    let began!: () => void; const ready = new Promise<void>(resolve => { began = resolve; });
    let cancelled!: () => void; const stopped = new Promise<void>(resolve => { cancelled = resolve; });
    const provider = vi.fn((_request, signal: AbortSignal) => new Promise<{ audio: string }>((_resolve, reject) => {
      signal.addEventListener('abort', () => { cancelled(); reject(signal.reason); }, { once: true }); began();
    }));
    const { url } = await start(provider); const controller = new AbortController();
    const request = fetch(url, { method: 'POST', headers: { authorization: 'Bearer test-token' }, body: JSON.stringify({ operation: 'synthesize', text: 'hello', cloudConsent: true }), signal: controller.signal }).catch(() => undefined);
    await ready; controller.abort(); await stopped; await request;
  });
});
