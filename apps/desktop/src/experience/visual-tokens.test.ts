import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COLOUR, MOTION } from './visual-tokens.ts';

const root = new URL('..', import.meta.url);
const css = readFileSync(new URL('app/globals.css', root), 'utf8');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => { const path = join(dir, name); return statSync(path).isDirectory() ? files(path) : [path]; });
}

describe('visual tokens', () => {
  it('mirrors every semantic colour as a CSS custom property', () => {
    for (const [name, hex] of Object.entries(COLOUR)) expect(css).toContain(`--c-${name}:${hex};`);
  });
  it('mirrors the motion durations', () => {
    for (const name of ['quick', 'settle', 'unfold', 'converge', 'decay', 'freeze'] as const) expect(css).toContain(`--m-${name}:${String(MOTION[name]).replace(/^0\./, '.')}s;`);
  });
  it('keeps colour literals out of experience components', () => {
    const dir = fileURLToPath(new URL('experience', root));
    const offenders = files(dir).filter(path => path.endsWith('.tsx') && !path.includes('visual-tokens')).filter(path => /['"`]#[0-9a-fA-F]{3,8}['"`]/.test(readFileSync(path, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
