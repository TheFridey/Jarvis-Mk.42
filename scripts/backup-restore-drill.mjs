import { spawnSync } from 'node:child_process';
const result = spawnSync('pnpm', ['exec', 'vitest', 'run', 'apps/core/test/backup-restore.integration.test.ts'], {
  stdio: 'inherit',
  env: { ...process.env, JARVIS_IT: '1' },
  shell: process.platform === 'win32',
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
