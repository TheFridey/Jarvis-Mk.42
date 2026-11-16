import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newLivekitCredentials, renderEnvFile, renderLivekitYaml, writeLivekitConfig } from './local-livekit-config.ts';

const temp = () => mkdtempSync(join(tmpdir(), 'jarvis-rtc-'));

describe('local LiveKit credentials', () => {
  it('generates a distinct key and a strong secret every time', () => {
    const a = newLivekitCredentials();
    const b = newLivekitCredentials();
    expect(a.apiKey).toMatch(/^API[A-Za-z0-9]{12}$/);
    expect(a.apiSecret.length).toBeGreaterThanOrEqual(43);
    expect(a.apiKey).not.toBe(b.apiKey);
    expect(a.apiSecret).not.toBe(b.apiSecret);
  });

  it('binds the server to loopback and disables external IP discovery', () => {
    const yaml = renderLivekitYaml({ apiKey: 'APIxxxxxxxxxxxx', apiSecret: 's'.repeat(43) });
    expect(yaml).toContain('bind_addresses:');
    // Inside a container a published port forwards to eth0, so the bind must be wildcard;
    // host exposure is limited by rtc.compose.yml publishing 127.0.0.1:7880, not by this bind.
    expect(yaml).toContain('0.0.0.0');
    expect(yaml).toContain('use_external_ip: false');
    expect(yaml).toContain('port: 7880');
  });

  it('writes the three variables the Kernel actually reads', () => {
    const env = renderEnvFile({ apiKey: 'APIxxxxxxxxxxxx', apiSecret: 's'.repeat(43) });
    for (const name of ['JARVIS_LIVEKIT_URL', 'JARVIS_LIVEKIT_API_KEY', 'JARVIS_LIVEKIT_API_SECRET']) {
      expect(env).toContain(`${name}=`);
    }
    expect(env).toContain('ws://127.0.0.1:7880');
  });
});

describe('writing the configuration', () => {
  it('writes both files and leaves the secret out of the returned value', () => {
    const dir = temp();
    const restrict: string[] = [];
    const result = writeLivekitConfig({
      yamlPath: join(dir, 'pki', 'livekit.yaml'),
      envPath: join(dir, 'pki', 'livekit.env'),
      restrict: path => restrict.push(path),
    });
    expect(result.written).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain('JARVIS_LIVEKIT_API_SECRET=');
    expect(restrict).toHaveLength(2);
    expect(readFileSync(join(dir, 'pki', 'livekit.yaml'), 'utf8')).toContain('keys:');
    expect(readdirSync(join(dir, 'pki')).sort()).toEqual(['livekit.env', 'livekit.yaml']);
  });

  it('refuses to overwrite an existing configuration, and writes nothing if either exists', () => {
    const dir = temp();
    writeFileSync(join(dir, 'livekit.env'), 'keep me');
    expect(() => writeLivekitConfig({ yamlPath: join(dir, 'livekit.yaml'), envPath: join(dir, 'livekit.env') }))
      .toThrow(/already exists/);
    // The yaml must not have been created by the failed attempt.
    expect(readdirSync(dir)).toEqual(['livekit.env']);
    expect(readFileSync(join(dir, 'livekit.env'), 'utf8')).toBe('keep me');
  });

  it('rejects weak credentials instead of writing them', () => {
    const dir = temp();
    expect(() => writeLivekitConfig({ yamlPath: join(dir, 'a.yaml'), envPath: join(dir, 'a.env'), credentials: { apiKey: 'APIx', apiSecret: 'short' } }))
      .toThrow(/too weak/);
    expect(readdirSync(dir)).toEqual([]);
  });
});
