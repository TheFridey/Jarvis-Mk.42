import { createHash } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { pipeline, type Readable } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { EgressRefusal, type AdapterEgress } from '../executor/hosted-adapter.ts';
import type { CredentialBroker } from '../credential-broker/broker.ts';
import { fetchInput, fetchOutput, type WebFetchOutput } from '../../../../../capabilities/web/definition.ts';
import { extractText } from './html-text.ts';

export interface ResolvedAddress { address: string; family: 4 | 6 }
export interface WebFetchPolicy {
  allowedPorts: number[]; maxRedirects: number; timeoutMs: number; maxBytes: number; defaultMaxChars: number; userAgent: string;
  allowedContentTypes: string[];
  /** Operator allowlist; when set, every hop including redirects must target one of these hosts. */
  allowedHosts?: string[];
  addressAllowed(address: string): boolean;
  resolve(hostname: string): Promise<ResolvedAddress[]>;
}

const blockedV4 = new BlockList();
for (const [network, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.31.196.0', 24], ['192.52.193.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['192.175.48.0', 24], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) blockedV4.addSubnet(network, prefix, 'ipv4');
// IPv6 is allow-listed to global unicast; mapped/compat/NAT64/ULA/link-local/multicast all fall outside 2000::/3.
const globalV6 = new BlockList(); globalV6.addSubnet('2000::', 3, 'ipv6');
const blockedV6 = new BlockList();
for (const [network, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]] as const) blockedV6.addSubnet(network, prefix, 'ipv6');

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedV4.check(address, 'ipv4');
  if (family === 6) return globalV6.check(address, 'ipv6') && !blockedV6.check(address, 'ipv6');
  return false;
}

export const DEFAULT_WEB_FETCH_POLICY: WebFetchPolicy = {
  allowedPorts: [80, 443], maxRedirects: 5, timeoutMs: 15_000, maxBytes: 1_500_000, defaultMaxChars: 8000,
  userAgent: 'JARVIS-WebFetch/1.1 (+operator-approved read-only research; no cookies)',
  allowedContentTypes: ['text/html', 'application/xhtml+xml', 'text/plain', 'application/json'],
  addressAllowed: isPublicAddress,
  async resolve(hostname) { return (await dnsLookup(hostname, { all: true, verbatim: true })).map(entry => ({ address: entry.address, family: entry.family === 6 ? 6 : 4 })); },
};

const LOCAL_SUFFIXES = ['.localhost', '.local', '.internal', '.intranet', '.lan', '.home', '.corp', '.home.arpa', '.localdomain'];

export class WebFetcher {
  readonly policy: WebFetchPolicy;
  constructor(policy: Partial<WebFetchPolicy> = {}, private readonly now = () => new Date().toISOString()) { this.policy = { ...DEFAULT_WEB_FETCH_POLICY, ...policy }; }

  /** Static validation of one hop. DNS answers are re-checked at connect time by `lookup`. */
  target(raw: string): URL {
    let url: URL;
    try { url = new URL(raw); } catch { throw new EgressRefusal('web fetch refused: malformed URL'); }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new EgressRefusal('web fetch refused: only http and https are allowed');
    if (url.username || url.password) throw new EgressRefusal('web fetch refused: credentials in URL');
    if (url.href.length > 2048) throw new EgressRefusal('web fetch refused: URL too long');
    const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
    if (!this.policy.allowedPorts.includes(port)) throw new EgressRefusal(`web fetch refused: port ${port} is not allowed`);
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
    if (!host) throw new EgressRefusal('web fetch refused: missing host');
    if (this.policy.allowedHosts && !this.policy.allowedHosts.includes(host)) throw new EgressRefusal('web fetch refused: host is not in the operator allowlist');
    if (isIP(host)) { if (!this.policy.addressAllowed(host)) throw new EgressRefusal('web fetch refused: non-public address'); return url; }
    if (host === 'localhost' || !host.includes('.') || LOCAL_SUFFIXES.some(suffix => host.endsWith(suffix))) throw new EgressRefusal('web fetch refused: local or internal hostname');
    return url;
  }

  async resolvePublic(hostname: string): Promise<ResolvedAddress[]> {
    let addresses: ResolvedAddress[];
    try { addresses = await this.policy.resolve(hostname); } catch { throw new EgressRefusal('web fetch failed: DNS resolution failed'); }
    if (addresses.length === 0) throw new EgressRefusal('web fetch failed: DNS returned no addresses');
    if (addresses.some(entry => !this.policy.addressAllowed(entry.address))) throw new EgressRefusal('web fetch refused: host resolves to a non-public address');
    return addresses;
  }

  async fetch(requested: string, maxChars = this.policy.defaultMaxChars): Promise<WebFetchOutput> {
    const signal = AbortSignal.timeout(this.policy.timeoutMs);
    let current = this.target(requested); const redirects: string[] = [];
    try {
      for (;;) {
        const response = await this.request(current, signal);
        const status = response.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status)) {
          response.destroy();
          const location = response.headers.location;
          if (!location) throw new EgressRefusal(`web fetch failed: redirect ${status} without Location`);
          if (redirects.length >= this.policy.maxRedirects) throw new EgressRefusal('web fetch refused: too many redirects');
          let next: URL; try { next = this.target(new URL(location, current).href); } catch (error) { throw error instanceof EgressRefusal ? new EgressRefusal(`${error.message} (redirect)`) : error; }
          if (current.protocol === 'https:' && next.protocol === 'http:') throw new EgressRefusal('web fetch refused: redirect downgrades https to http');
          redirects.push(next.href); current = next; continue;
        }
        if (status < 200 || status > 299) { response.destroy(); throw new EgressRefusal(`web fetch failed: upstream status ${status}`); }
        const contentType = String(response.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
        if (!this.policy.allowedContentTypes.includes(contentType)) { response.destroy(); throw new EgressRefusal(`web fetch refused: content type ${contentType || 'missing'} is not allowed`); }
        const body = await this.read(response);
        const raw = decode(body.buffer, String(response.headers['content-type'] ?? ''), contentType);
        const page = extractText(raw, contentType, current.href);
        const limit = Math.min(Math.max(maxChars, 500), 12000);
        return fetchOutput.parse({
          url: requested, finalUrl: current.href, status, contentType,
          title: page.title, description: page.description, text: page.text.slice(0, limit), links: page.links,
          truncated: body.truncated || page.text.length > limit, bytes: body.bytes,
          contentSha256: createHash('sha256').update(JSON.stringify([page.title, page.text])).digest('hex'),
          redirects, fetchedAt: this.now(), trust: 'untrusted',
        });
      }
    } catch (error) {
      if (error instanceof EgressRefusal) throw error;
      if (signal.aborted) throw new EgressRefusal('web fetch failed: timed out');
      throw new EgressRefusal('web fetch failed: network error');
    }
  }

  private request(url: URL, signal: AbortSignal): Promise<IncomingMessage> {
    const lookup: LookupFunction = (hostname, options, callback) => {
      this.resolvePublic(hostname).then(addresses => {
        if (options.all) callback(null, addresses);
        else callback(null, addresses[0]!.address, addresses[0]!.family);
      }, (error: Error) => callback(Object.assign(error, { code: 'EJARVISEGRESS' }), '', 0));
    };
    return new Promise((resolve, reject) => {
      const transport = url.protocol === 'https:' ? https : http;
      const request = transport.request(url, {
        method: 'GET', agent: false, lookup, signal, timeout: this.policy.timeoutMs, maxHeaderSize: 32 * 1024,
        headers: { 'user-agent': this.policy.userAgent, accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,application/json;q=0.8', 'accept-encoding': 'gzip, deflate, br', 'accept-language': 'en-GB,en;q=0.8' },
      }, resolve);
      request.on('error', reject);
      request.on('timeout', () => request.destroy(new Error('socket timeout')));
      request.end();
    });
  }

  private async read(response: IncomingMessage): Promise<{ buffer: Buffer; truncated: boolean; bytes: number }> {
    const encoding = String(response.headers['content-encoding'] ?? 'identity').trim().toLowerCase();
    const decoder = encoding === 'gzip' || encoding === 'x-gzip' ? createGunzip() : encoding === 'deflate' ? createInflate() : encoding === 'br' ? createBrotliDecompress() : undefined;
    if (!decoder && encoding !== 'identity' && encoding !== '') { response.destroy(); throw new EgressRefusal(`web fetch refused: unsupported content encoding ${encoding}`); }
    const stream: Readable = decoder ? pipeline(response, decoder, () => undefined) : response;
    const chunks: Buffer[] = []; let bytes = 0; let truncated = false;
    try {
      for await (const chunk of stream as AsyncIterable<Buffer>) {
        const remaining = this.policy.maxBytes - bytes;
        if (chunk.length >= remaining) { chunks.push(chunk.subarray(0, remaining)); bytes += remaining; truncated = true; break; }
        chunks.push(chunk); bytes += chunk.length;
      }
    } finally { stream.destroy(); response.destroy(); }
    return { buffer: Buffer.concat(chunks), truncated, bytes };
  }
}

function decode(buffer: Buffer, header: string, contentType: string): string {
  let charset = /charset\s*=\s*"?([\w.:-]+)/i.exec(header)?.[1];
  if (!charset && contentType !== 'application/json') {
    const head = buffer.subarray(0, 2048).toString('latin1');
    charset = /<meta[^<>]*charset\s*=\s*["']?([\w.:-]+)/i.exec(head)?.[1];
  }
  try { return new TextDecoder(charset ?? 'utf-8').decode(buffer); } catch { return new TextDecoder('utf-8').decode(buffer); }
}

/** Kernel egress for capabilities.web. Only called by Adapter Host after Executor minted authority. */
export class WebFetchEgress {
  readonly fetcher: WebFetcher;
  constructor(private readonly broker: Pick<CredentialBroker, 'redeem'>, policy: Partial<WebFetchPolicy> = {}, now?: () => string) { this.fetcher = new WebFetcher(policy, now); }
  readonly run: AdapterEgress = async (job, req) => {
    if (job.capabilityId !== 'capabilities.web' || job.action !== 'fetch') throw new Error('Egress denied');
    const input = fetchInput.parse(job.input);
    if (req.method !== 'GET' || req.url !== input.url || req.body !== undefined) throw new Error('Egress denied');
    if (job.handle.invocationId !== job.invocationId || job.handle.scope.capabilityId !== job.capabilityId || job.handle.mode !== job.mode || ![job.action, 'verify'].includes(job.handle.scope.action)) throw new Error('Credential binding mismatch');
    if (this.broker.redeem(job.handle.handleId, job.invocationId).readOnly !== (job.mode === 'dry-run')) throw new Error('Credential unavailable');
    const page = await this.fetcher.fetch(input.url, input.maxChars);
    if (job.mode === 'full') return page;
    // Executor readback: an independent second fetch must reproduce the recorded content.
    const recorded = fetchOutput.safeParse(job.output);
    if (recorded.success && recorded.data.url === input.url && recorded.data.finalUrl === page.finalUrl && recorded.data.status === page.status && recorded.data.contentSha256 === page.contentSha256) return recorded.data;
    return page;
  };
}
