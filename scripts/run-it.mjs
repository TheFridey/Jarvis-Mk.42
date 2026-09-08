// Cross-platform launcher for the integration suite.
// Sets JARVIS_IT=1 (so vitest.config.ts selects the integration include set)
// and runs vitest. Integration tests self-skip when Docker is unavailable.
import { spawnSync } from 'node:child_process';

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
