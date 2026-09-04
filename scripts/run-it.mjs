// Cross-platform launcher for the integration suite.
// Sets JARVIS_IT=1 (so vitest.config.ts selects the integration include set)
// and runs vitest. Integration tests self-skip when Docker is unavailable.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const res = spawnSync(
  process.execPath,
  [fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url)), 'run'],
  { stdio: 'inherit', env: { ...process.env, JARVIS_IT: '1' } },
);
if (res.error) console.error(res.error.message);
process.exit(res.status ?? 1);
