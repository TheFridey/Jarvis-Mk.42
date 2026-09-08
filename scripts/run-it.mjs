// Cross-platform launcher for the integration suite.
// Sets JARVIS_IT=1 (so vitest.config.ts selects the integration include set)
// and runs vitest.
//
// MANDATORY GATE. The integration tests themselves `describe.skipIf(!dockerOk)`,
// which means that without Docker vitest exits 0 with every suite skipped — a
// green gate that proved nothing. That false-green was observed live during the
// MK.42 release-candidate audit (57 integration tests silently skipped inside a
// passing `verify:full`). Fail loudly instead, matching run-chaos.mjs and
// backup-restore-drill.mjs.
import { spawnSync } from 'node:child_process';

const docker = spawnSync('docker', ['ps'], { stdio: 'ignore', shell: process.platform === 'win32' });
if (docker.status !== 0) {
  console.error('MANDATORY INTEGRATION GATE FAILED: Docker daemon is unavailable, so every integration suite would self-skip and report a false green.');
  process.exit(1);
}

const res = spawnSync(
  'pnpm',
  ['exec', 'vitest', 'run'],
  { stdio: 'inherit', env: { ...process.env, JARVIS_IT: '1' }, shell: process.platform === 'win32' },
);
if (res.error) console.error(res.error.message);

// Safety net: a vitest hook timeout aborts the *test*, not the underlying
// promise chain that spun up an ephemeral `jarvis-it-pg-*` container — Node
// cannot cancel a pending promise, so a timed-out beforeAll can leak a
// container that outlives this whole process (observed: a leaked container
// degraded the Docker daemon badly enough to make later runs falsely report
// "Docker unavailable"). Sweep for stragglers unconditionally on exit.
const list = spawnSync('docker', ['ps', '-aq', '--filter', 'name=jarvis-it-pg-'], { encoding: 'utf8' });
const ids = (list.stdout ?? '').trim().split(/\r?\n/).filter(Boolean);
if (ids.length > 0) {
  console.error(`run-it: sweeping ${ids.length} leaked ephemeral test container(s)`);
  spawnSync('docker', ['rm', '-f', ...ids], { stdio: 'inherit' });
}

process.exit(res.status ?? 1);
