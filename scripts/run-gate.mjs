import { spawnSync } from 'node:child_process';
const gate = process.argv[2];
if (!['contract', 'security', 'fitness', 'chaos'].includes(gate)) throw new Error(`unknown gate: ${gate}`);
const result = spawnSync('pnpm', ['exec', 'vitest', 'run'], {
  stdio: 'inherit',
  env: { ...process.env, JARVIS_GATE: gate },
  shell: process.platform === 'win32',
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
