import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { assertProviderBaseUrl, providerVerificationEnabled } from './runtime-config.ts';
import { OpenAICompatibleAdapter } from './adapters/openai-compatible.ts';

/**
 * Adversarial egress.
 *
 * None of these cases contacts an external service: the rejection must happen before a socket is
 * opened, so proving that "example.com was not reached" is a property of the validator, not a
 * measurement of the internet.
 */

const verify = { verification: true } as const;
const clean: NodeJS.ProcessEnv = {};

describe('provider endpoint validation', () => {
  it('accepts a numeric loopback endpoint with an explicit port', () => {
    const url = assertProviderBaseUrl('http://127.0.0.1:41234/v1', { ...verify, env: clean });
    expect(url.hostname).toBe('127.0.0.1');
  });

  it('rejects a hostname, even a loopback-looking one', () => {
    expect(() => assertProviderBaseUrl('http://localhost:41234/v1', { ...verify, env: clean })).toThrow(/numeric loopback/);
  });

  it('rejects a non-loopback IP', () => {
    expect(() => assertProviderBaseUrl('http://10.0.0.5:8080/v1', { ...verify, env: clean })).toThrow(/numeric loopback/);
    expect(() => assertProviderBaseUrl('http://192.168.1.10:8080/v1', { ...verify, env: clean })).toThrow(/numeric loopback/);
  });

  it('rejects a public hostname', () => {
    expect(() => assertProviderBaseUrl('https://openrouter.ai/api/v1', { ...verify, env: clean })).toThrow();
  });

  it('rejects an unexpected scheme', () => {
    expect(() => assertProviderBaseUrl('file:///etc/passwd', { ...verify, env: clean })).toThrow(/scheme|plain-http/);
    expect(() => assertProviderBaseUrl('ftp://127.0.0.1:21/v1', { ...verify, env: clean })).toThrow(/scheme|plain-http/);
  });

  it('rejects embedded credentials', () => {
    expect(() => assertProviderBaseUrl('http://user:pass@127.0.0.1:41234/v1', { ...verify, env: clean })).toThrow(/credentials/);
  });

  it('is not fooled by a userinfo trick', () => {
    // The host here is evil.example, not 127.0.0.1.
    expect(() => assertProviderBaseUrl('http://127.0.0.1@evil.example:41234/v1', { ...verify, env: clean })).toThrow(/credentials|loopback/);
  });

  it('requires an explicit port', () => {
    expect(() => assertProviderBaseUrl('http://127.0.0.1/v1', { ...verify, env: clean })).toThrow(/port/);
  });

  it('refuses to run with proxy variables set', () => {
    expect(() => assertProviderBaseUrl('http://127.0.0.1:41234/v1', { ...verify, env: { HTTP_PROXY: 'http://proxy.internal:3128' } })).toThrow(/HTTP_PROXY/);
    expect(() => assertProviderBaseUrl('http://127.0.0.1:41234/v1', { ...verify, env: { HTTPS_PROXY: 'http://proxy.internal:3128' } })).toThrow(/HTTPS_PROXY/);
  });

  it('leaves production configuration alone when verification is off', () => {
    expect(() => assertProviderBaseUrl('https://openrouter.ai/api/v1', { verification: false, env: clean })).not.toThrow();
    expect(() => assertProviderBaseUrl('https://openrouter.ai/api/v1', { verification: false, env: { HTTP_PROXY: 'http://proxy.internal:3128' } })).not.toThrow();
  });

  it('only treats an explicit 1 as verification mode', () => {
    expect(providerVerificationEnabled({ JARVIS_ALLOW_PROVIDER_REDIRECT: '1' } as NodeJS.ProcessEnv)).toBe(true);
    expect(providerVerificationEnabled({ JARVIS_ALLOW_PROVIDER_REDIRECT: 'true' } as NodeJS.ProcessEnv)).toBe(false);
    expect(providerVerificationEnabled({} as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe('transport behaviour in verification mode', () => {
  let server: Server;
  let base = '';
  const isolated: typeof fetch = (input, init) => fetch(input, { ...init, redirect: 'error' });

  beforeAll(async () => {
    server = createServer((request, response) => {
      if ((request.url ?? '').includes('/redirect')) {
        response.writeHead(302, { location: 'http://example.com/v1/models' });
        response.end();
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ object: 'list', data: [] }));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });

  afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });

  const registration = { id: 'fixture-model', provider: 'openrouter', displayName: 'fixture', tasks: ['reason'], locality: 'cloud-ok', costPer1kTokens: 0 } as never;

  it('turns a redirect into an error instead of a hop', async () => {
    const adapter = new OpenAICompatibleAdapter('openrouter', `${base}/redirect`, 'fixture-key', isolated);
    await expect(adapter.health(registration, AbortSignal.timeout(2000))).rejects.toThrow();
  });

  it('fails deterministically when the fixture is unavailable', async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    const adapter = new OpenAICompatibleAdapter('openrouter', base, 'fixture-key', isolated);
    const started = Date.now();
    await expect(adapter.health(registration, AbortSignal.timeout(1500))).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(3000);
    // Restore for afterAll.
    server = createServer((_request, response) => { response.writeHead(200); response.end('{}'); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  });
});
