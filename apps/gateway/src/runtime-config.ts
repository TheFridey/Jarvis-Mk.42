export const DEVELOPMENT_GATEWAY_TOKEN = 'dev-gateway-token';

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost' || normalized === '::1' || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

export function assertGatewayIngressIsSecure(host: string, token: string): void {
  if (!isLoopbackHost(host) && token === DEVELOPMENT_GATEWAY_TOKEN) {
    throw new Error('refusing non-loopback model-gateway ingress with the default gateway credential; set JARVIS_GATEWAY_TOKEN or bind to loopback');
  }
}

/**
 * Isolated provider verification.
 *
 * A redirect opt-in proves intent, not isolation. When verification mode is on, the provider base
 * URL must be a numeric loopback address with no credentials, and the process must not carry proxy
 * settings that could route traffic elsewhere. Production is untouched: with verification off,
 * nothing here is evaluated.
 */

export const PROVIDER_REDIRECT_FLAG = 'JARVIS_ALLOW_PROVIDER_REDIRECT';
const PROXY_VARIABLES = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'];
const NUMERIC_LOOPBACK = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function providerVerificationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[PROVIDER_REDIRECT_FLAG] === '1';
}

export function assertProviderBaseUrl(baseUrl: string, options: { verification: boolean; env?: NodeJS.ProcessEnv }): URL {
  const env = options.env ?? process.env;
  let parsed: URL;
  try { parsed = new URL(baseUrl); } catch { throw new Error(`provider base URL is not a URL: ${baseUrl}`); }

  if (parsed.username || parsed.password) throw new Error('provider base URL must not embed credentials');
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error(`unsupported provider scheme: ${parsed.protocol}`);

  if (!options.verification) return parsed;

  if (parsed.protocol !== 'http:') throw new Error('verification mode requires a plain-http provider endpoint');
  const match = NUMERIC_LOOPBACK.exec(parsed.hostname);
  if (!match || match.slice(1).some(octet => Number(octet) > 255)) {
    throw new Error(`verification mode requires a numeric loopback provider host, got ${parsed.hostname}`);
  }
  if (!parsed.port) throw new Error('verification mode requires an explicit provider port');
  for (const name of PROXY_VARIABLES) {
    if (env[name]) throw new Error(`verification mode refuses to run with ${name} set (proxy routing possible)`);
  }
  return parsed;
}
