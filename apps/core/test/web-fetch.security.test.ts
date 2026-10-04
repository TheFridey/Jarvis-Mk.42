import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { gzipSync } from 'node:zlib';
import type { AddressInfo } from 'node:net';
import { EgressRefusal, type AdapterJob } from '../src/kernel/executor/hosted-adapter.ts';
import { isPublicAddress, WebFetchEgress, WebFetcher, type WebFetchPolicy } from '../src/kernel/integrations/web-fetch.ts';

const seen: IncomingHttpHeaders[] = [];
let server: Server, port = 0, version = 'v1';
const hosts: Record<string, string[]> = { 'public.test': ['127.0.0.1'], 'private.test': ['10.0.0.7'], 'mixed.test': ['93.184.216.34', '192.168.1.1'], 'meta.test': ['169.254.169.254'], 'v6.test': ['fd00:ec2::254'] };
const policy = (overrides: Partial<WebFetchPolicy> = {}): Partial<WebFetchPolicy> => ({
  allowedPorts: [port], timeoutMs: 2000,
  addressAllowed: address => address === '127.0.0.1' || isPublicAddress(address),
  resolve: async hostname => { const found = hosts[hostname]; if (!found) throw new Error('NXDOMAIN'); return found.map(address => ({ address, family: address.includes(':') ? 6 as const : 4 as const })); },
  ...overrides,
});
const url = (path: string, host = 'public.test') => `http://${host}:${port}${path}`;
const html = `<html><head><title>Public page</title></head><body><h1>Welcome</h1><p>We build websites.</p><script>steal()</script></body></html>`;

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push(req.headers);
    const go = (location: string) => { res.writeHead(302, { location, 'set-cookie': 'session=abc' }); res.end(); };
    switch (req.url) {
      case '/page': res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'set-cookie': 'tracker=1' }); res.end(html); return;
      case '/changing': res.writeHead(200, { 'content-type': 'text/plain' }); res.end(`content ${version}`); return;
      case '/redirect-ok': go('/page'); return;
      case '/redirect-private': go(url('/x', 'private.test')); return;
      case '/redirect-meta': go('http://169.254.169.254/latest/meta-data/'); return;
      case '/redirect-ftp': go('ftp://public.test/file'); return;
      case '/redirect-loop': go('/redirect-loop'); return;
      case '/big': res.writeHead(200, { 'content-type': 'text/plain' }); res.end('a'.repeat(3_000_000)); return;
      case '/gzip': res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' }); res.end(gzipSync(html)); return;
      case '/bomb': res.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'gzip' }); res.end(gzipSync(Buffer.alloc(50_000_000))); return;
      case '/image': res.writeHead(200, { 'content-type': 'image/png' }); res.end(Buffer.alloc(10)); return;
      case '/missing': res.writeHead(404, { 'content-type': 'text/html' }); res.end('nope'); return;
      case '/slow': return;
      default: res.writeHead(500); res.end();
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });

describe('web fetch SSRF protection', () => {
  it('classifies private, loopback, link-local, metadata, CGNAT, multicast and non-global IPv6 as non-public', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.0.1', '169.254.169.254', '100.100.100.200', '0.0.0.0', '224.0.0.1', '255.255.255.255', '198.18.0.1', '::1', '::', 'fe80::1', 'fd00:ec2::254', 'fc00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::7f00:1', '2002:7f00:1::', '2001:db8::1', 'ff02::1', 'not-an-ip']) expect(isPublicAddress(address), address).toBe(false);
    for (const address of ['93.184.216.34', '1.1.1.1', '2606:4700:4700::1111', '2a00:1450:4009:81f::200e']) expect(isPublicAddress(address), address).toBe(true);
  });

  it('refuses non-http schemes, credentials, odd ports, local hostnames and private IP literals before any connection', () => {
    const fetcher = new WebFetcher();
    for (const target of ['file:///etc/passwd', 'ftp://example.com/', 'javascript:alert(1)', 'data:text/html,hi', 'gopher://example.com/', 'https://user:pw@example.com/', 'https://example.com:8443/', 'http://localhost/', 'http://intranet/', 'http://printer.local/', 'http://metadata.google.internal/', 'http://127.0.0.1/', 'http://2130706433/', 'http://0x7f.1/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.1/', 'not a url'])
      expect(() => fetcher.target(target), target).toThrow(EgressRefusal);
    expect(fetcher.target('https://scalesmiths.co.uk/').hostname).toBe('scalesmiths.co.uk');
    expect(() => new WebFetcher({ allowedHosts: ['scalesmiths.co.uk'] }).target('https://example.com/')).toThrow('allowlist');
  });

  it('re-checks DNS answers at connect time, rejecting any non-public address in the answer set', async () => {
    const fetcher = new WebFetcher(policy());
    await expect(fetcher.fetch(url('/page', 'private.test'))).rejects.toThrow('non-public address');
    await expect(fetcher.fetch(url('/page', 'mixed.test'))).rejects.toThrow('non-public address');
    await expect(fetcher.fetch(url('/page', 'meta.test'))).rejects.toThrow('non-public address');
    await expect(fetcher.fetch(url('/page', 'v6.test'))).rejects.toThrow('non-public address');
    await expect(fetcher.fetch(url('/page', 'unknown.test'))).rejects.toThrow('DNS resolution failed');
  });

  it('validates every redirect hop and bounds the redirect chain', async () => {
    const fetcher = new WebFetcher(policy());
    await expect(fetcher.fetch(url('/redirect-private'))).rejects.toThrow('non-public address');
    await expect(fetcher.fetch(url('/redirect-meta'))).rejects.toThrow(/non-public address|port/);
    await expect(fetcher.fetch(url('/redirect-ftp'))).rejects.toThrow('only http and https');
    await expect(fetcher.fetch(url('/redirect-loop'))).rejects.toThrow('too many redirects');
  });

  it('follows a safe redirect without cookies or credentials and sends an identifiable User-Agent', async () => {
    seen.length = 0;
    const page = await new WebFetcher(policy()).fetch(url('/redirect-ok'));
    expect(page).toMatchObject({ url: url('/redirect-ok'), finalUrl: url('/page'), status: 200, contentType: 'text/html', title: 'Public page', trust: 'untrusted', redirects: [url('/page')] });
    expect(page.text).toContain('We build websites.'); expect(page.text).not.toContain('steal');
    expect(seen).toHaveLength(2);
    for (const headers of seen) { expect(headers.cookie).toBeUndefined(); expect(headers.authorization).toBeUndefined(); expect(headers['user-agent']).toMatch(/^JARVIS-WebFetch\//); }
  });

  it('enforces size limits (including decompression bombs), content types, status and timeouts', async () => {
    const fetcher = new WebFetcher(policy({ maxBytes: 100_000 }));
    const big = await fetcher.fetch(url('/big'), 1000);
    expect(big).toMatchObject({ bytes: 100_000, truncated: true }); expect(big.text).toHaveLength(1000);
    expect(await fetcher.fetch(url('/bomb'))).toMatchObject({ bytes: 100_000, truncated: true });
    expect((await fetcher.fetch(url('/gzip'))).title).toBe('Public page');
    await expect(fetcher.fetch(url('/image'))).rejects.toThrow('content type image/png');
    await expect(fetcher.fetch(url('/missing'))).rejects.toThrow('upstream status 404');
    await expect(new WebFetcher(policy({ timeoutMs: 300 })).fetch(url('/slow'))).rejects.toThrow('timed out');
  });
});

describe('web fetch Kernel egress binding', () => {
  const job = (mode: 'full' | 'dry-run', overrides: Partial<AdapterJob> = {}): AdapterJob => ({ invocationId: 'inv-1', capabilityId: 'capabilities.web', version: '1.1.0', action: 'fetch', input: { url: url('/changing') }, mode, timeoutMs: 20000, riskClass: 'LOW', executionEnvironment: 'worker', moduleUrl: 'file:///web.ts', handle: { handleId: `h-${mode}`, invocationId: 'inv-1', scope: { capabilityId: 'capabilities.web', action: mode === 'full' ? 'fetch' : 'verify', resourceRef: 'r' }, mode, expiresAt: '2099-01-01T00:00:00Z', kind: 'none' }, ...overrides });
  const broker = { redeem: (handleId: string) => ({ readOnly: handleId.endsWith('dry-run'), signRequest: () => '' }) };

  it('only serves GET of the exact authorised URL with a handle bound to the invocation', async () => {
    const egress = new WebFetchEgress(broker, policy());
    await expect(egress.run(job('full'), { method: 'GET', url: url('/page') })).rejects.toThrow('Egress denied');
    await expect(egress.run(job('full'), { method: 'POST', url: url('/changing') })).rejects.toThrow('Egress denied');
    await expect(egress.run(job('full', { capabilityId: 'capabilities.email' }), { method: 'GET', url: url('/changing') })).rejects.toThrow('Egress denied');
    await expect(egress.run(job('full', { handle: { ...job('full').handle, invocationId: 'other' } }), { method: 'GET', url: url('/changing') })).rejects.toThrow('Credential binding mismatch');
    await expect(egress.run(job('full', { input: { url: url('/changing'), extra: 1 } }), { method: 'GET', url: url('/changing') })).rejects.toThrow();
  });

  it('verifies by independent re-fetch: unchanged content reproduces the record, changed content does not', async () => {
    const egress = new WebFetchEgress(broker, policy());
    version = 'v1';
    const recorded = await egress.run(job('full'), { method: 'GET', url: url('/changing') }) as { contentSha256: string; fetchedAt: string };
    expect(await egress.run(job('dry-run', { output: recorded }), { method: 'GET', url: url('/changing') })).toEqual(recorded);
    version = 'v2';
    const reread = await egress.run(job('dry-run', { output: recorded }), { method: 'GET', url: url('/changing') }) as { contentSha256: string };
    expect(reread.contentSha256).not.toBe(recorded.contentSha256);
  });
});
