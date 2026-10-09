import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const manifest = JSON.parse(readFileSync(new URL('../docs/repository/preserved-assets.json', import.meta.url), 'utf8'));
for (const asset of manifest.assets) {
  const bytes = readFileSync(new URL(`../${asset.path}`, import.meta.url));
  if (bytes.length !== asset.bytes || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) {
    throw new Error(`Preserved asset changed: ${asset.path}. Review and explicitly update its pin.`);
  }
}
process.stdout.write(`Verified ${manifest.assets.length} preserved source assets and visual references.\n`);
