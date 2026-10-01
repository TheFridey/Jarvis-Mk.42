import { describe, expect, it } from 'vitest';
import { assertGatewayIngressIsSecure, DEVELOPMENT_GATEWAY_TOKEN } from './runtime-config.ts';

describe('model gateway ingress root of trust', () => {
  it('rejects a wildcard bind with the development credential', () => {
    expect(() => assertGatewayIngressIsSecure('0.0.0.0', DEVELOPMENT_GATEWAY_TOKEN)).toThrow(/refusing non-loopback model-gateway ingress/);
  });

  it('permits explicit loopback development and replaced remote credentials', () => {
    expect(() => assertGatewayIngressIsSecure('127.0.0.1', DEVELOPMENT_GATEWAY_TOKEN)).not.toThrow();
    expect(() => assertGatewayIngressIsSecure('0.0.0.0', 'operator-supplied-token')).not.toThrow();
  });
});
