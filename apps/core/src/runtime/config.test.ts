import { describe, expect, it } from 'vitest';
import { DEVELOPMENT_BOOTSTRAP_CREDENTIAL, loadConfig } from './config.ts';
import { buildKernel } from '../kernel/lifecycle/kernel.ts';

describe('ingress root-of-trust configuration', () => {
  it.each(['0.0.0.0', '192.168.1.20', 'jarvis.local', '::'])('rejects the development bootstrap credential on non-loopback host %s', (diagnosticsHost) => {
    expect(() => loadConfig({ diagnosticsHost, bootstrapCredential: DEVELOPMENT_BOOTSTRAP_CREDENTIAL })).toThrow(/refusing non-loopback diagnostics ingress/);
  });

  it.each(['127.0.0.1', '127.0.0.2', 'localhost', '::1', '[::1]'])('keeps explicit local development available on %s', (diagnosticsHost) => {
    expect(loadConfig({ diagnosticsHost }).diagnosticsHost).toBe(diagnosticsHost);
  });

  it('allows a non-loopback bind only with an explicitly replaced bootstrap credential', () => {
    expect(loadConfig({ diagnosticsHost: '0.0.0.0', bootstrapCredential: 'operator-supplied-long-secret' }).diagnosticsHost).toBe('0.0.0.0');
  });

  it('rechecks the guard when KernelConfig bypasses loadConfig', async () => {
    const config = loadConfig({ telemetryDisabled: true, natsEnabled: false });
    config.diagnosticsHost = '0.0.0.0';
    const kernel = buildKernel(config, { noHttp: true, noScheduler: true });
    await expect(kernel.start()).rejects.toThrow(/refusing non-loopback diagnostics ingress/);
  });
});
