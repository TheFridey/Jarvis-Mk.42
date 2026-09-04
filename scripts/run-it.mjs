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
process.exit(res.status ?? 1);
