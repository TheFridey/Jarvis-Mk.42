import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * No control characters in source.
 *
 * Twice in one operation a `\b` or a `\t` inside a generated string was written as the actual
 * byte — once turning a path into a tab, once turning a word-boundary into a backspace. Both
 * compiled, both passed review, and both were found only by their runtime symptoms. This test
 * catches the class at build time.
 */

const root = fileURLToPath(new URL('../../../../../', import.meta.url));

function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === 'out' || entry === 'dist') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sources(path, found);
    else if (/\.(ts|tsx|mts|ps1|json)$/.test(entry)) found.push(path);
  }
  return found;
}

describe('source hygiene', () => {
  it('contains no control characters outside whitespace', () => {
    const offenders: string[] = [];
    for (const file of sources(join(root, 'apps')).concat(sources(join(root, 'packages')), sources(join(root, 'scripts')))) {
      const text = readFileSync(file, 'utf8');
      for (const character of text) {
        const code = character.charCodeAt(0);
        if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
          offenders.push(`${file.split(/[\\/]/).slice(-2).join('/')} contains ${code}`);
          break;
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
