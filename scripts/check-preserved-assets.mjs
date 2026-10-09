import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const manifest = JSON.parse(readFileSync(new URL('../docs/repository/preserved-assets.json', import.meta.url), 'utf8'));
const generatedRoots = ['apps/desktop/out/', 'apps/desktop/visual-validation/motion/',
  'artifacts/companion/', 'artifacts/mark42/', 'test-results/', 'playwright-report/', 'blob-report/'];
const tracked = execFileSync('git', ['ls-files', '-z'], {
  cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8',
}).split('\0').filter(Boolean);
for (const path of tracked) {
  if (generatedRoots.some(root => path.startsWith(root)) || path === 'artifacts/local-runtime/desktop.png') {
    throw new Error(`Generated output must not be source-tracked: ${path}`);
  }
}
for (const asset of manifest.assets) {
  const bytes = readFileSync(new URL(`../${asset.path}`, import.meta.url));
  if (bytes.length !== asset.bytes || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) {
    throw new Error(`Preserved asset changed: ${asset.path}. Review and explicitly update its pin.`);
  }
}
process.stdout.write(`Verified ${manifest.assets.length} preserved source assets and visual references.\n`);
