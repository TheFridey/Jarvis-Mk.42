import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Launcher hygiene.
 *
 * A previous change wrote an environment value with an escaped separator, so the launcher
 * carried a literal control byte in a path and died half-way through with "Illegal
 * characters in path" — after starting the Gateway and before the Kernel, leaving one
 * service listening alone. These assertions make that class of defect fail here instead.
 */

const source = readFileSync(fileURLToPath(new URL('../../../../scripts/jarvis-up.ps1', import.meta.url)), 'utf8');
const NOT_WHITESPACE = new Set([9, 10, 13]);

describe('launcher', () => {
  it('contains no control characters in its text', () => {
    const control = [...source].filter(character => {
      const code = character.charCodeAt(0);
      return code < 32 && !NOT_WHITESPACE.has(code);
    });
    expect(control).toEqual([]);
  });

  it('uses forward slashes for the speech paths so nothing can be read as an escape', () => {
    const pathLines = source.split(/\r?\n/).filter(line => line.includes('Speech/') || line.includes('whisper-arm64') || line.includes('ggml-base'));
    expect(pathLines.length).toBeGreaterThan(0);
    const backslashed = pathLines.filter(line => /[A-Za-z][:][\\]/.test(line));
    expect(backslashed).toEqual([]);
  });

  it('validates its paths before it sets them', () => {
    const preflight = source.indexOf('Assert-CleanPath');
    const firstUse = source.indexOf('$env:JARVIS_ASR_ENGINE');
    expect(preflight).toBeGreaterThan(-1);
    expect(firstUse).toBeGreaterThan(preflight);
  });

  it('still knows how to stop everything it started', () => {
    expect(source).toContain('Stop-Tree');
    expect(source).toContain('-Down');
  });
});
