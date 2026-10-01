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
