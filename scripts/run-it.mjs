// Cross-platform launcher for the integration suite.
// Sets JARVIS_IT=1 (so vitest.config.ts selects the integration include set)
// and runs vitest. Integration tests self-skip when Docker is unavailable.
import { spawnSync } from 'node:child_process';

const res = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vitest', 'run'],
  { stdio: 'inherit', env: { ...process.env, JARVIS_IT: '1' } },
);
process.exit(res.status ?? 1);
