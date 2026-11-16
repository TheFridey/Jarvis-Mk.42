/**
 * Generate the local-development LiveKit configuration.
 *
 * Explicit operator invocation only:
 *   node "C:/Users/rhysl/AppData/Local/node/corepack/v1/pnpm/9.15.9/bin/pnpm.cjs" rtc:config
 *
 * Writes, never prints, never overwrites:
 *   artifacts/local-runtime/pki/livekit.yaml   (server config, mounted read-only)
 *   artifacts/local-runtime/pki/livekit.env    (the three Kernel variables)
 *
 * Both are under a git-ignored directory and are ACL-restricted to the current user.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeLivekitConfig } from '../apps/core/src/kernel/rtc/local-livekit-config.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const pki = join(root, 'artifacts', 'local-runtime', 'pki');
const yamlPath = join(pki, 'livekit.yaml');
const envPath = join(pki, 'livekit.env');

const show = (path: string) => relative(root, path).replaceAll('\\', '/');

/** Windows: remove inherited ACEs and grant the current user alone. */
function restrict(path: string) {
  if (process.platform !== 'win32') return;
  const user = process.env.USERNAME;
  if (!user) throw new Error('USERNAME is not set; cannot restrict ACLs');
  for (const args of [['/inheritance:r'], ['/grant:r', `${user}:F`]]) {
    const result = spawnSync('icacls', [path, ...args], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`icacls failed for ${path}: ${result.stderr?.trim() ?? result.status}`);
  }
}

if (existsSync(yamlPath) || existsSync(envPath)) {
  console.error('Refusing to overwrite: LiveKit configuration already exists.');
  console.error(`  ${show(yamlPath)}${existsSync(yamlPath) ? '' : ' (absent)'}`);
  console.error(`  ${show(envPath)}${existsSync(envPath) ? '' : ' (absent)'}`);
  console.error('Delete both deliberately if you really want new credentials; existing sessions will be invalidated.');
  process.exit(1);
}

try {
  const result = writeLivekitConfig({ yamlPath, envPath, restrict });
  console.log('Local LiveKit configuration generated (values not shown).');
  for (const path of result.written) console.log(`  wrote ${show(path)}`);
  console.log('');
  console.log('Next:');
  console.log('  1. powershell -ExecutionPolicy Bypass -File scripts\\jarvis-up.ps1');
  console.log('     (the launcher sources livekit.env and starts the RTC container when this file exists)');
  console.log('  2. Confirm: Invoke-RestMethod http://127.0.0.1:7420/diagnostics |');
  console.log('     Select-Object -Expand dependencies | Where-Object name -eq rtc');
  console.log('  3. Open presence and press the microphone yourself.');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
