import { describe, expect, it, vi } from 'vitest';
import { ContextCompiler, type ContextCompilerDeps } from './context-compiler.ts';

/**
 * Outbound privacy at the compiler boundary: the sentinel below stands in for a private
 * business record. It must not appear in a context compiled for a cloud ceiling, and a
 * package that would require it must be refused rather than quietly trimmed.
 */

const SENTINEL = 'SENTINEL-RESTRICTED-7f3a';

/** A state view where every slice exists but holds nothing: no ambient private state. */
const emptyState = () => new Proxy({} as Record<string, unknown>, {
  get: (_target, key) => {
    if (key === 'slices') return new Proxy({}, { get: () => ({ value: null }) });
    if (key === 'stateVersion') return 1;
    if (key === 'generatedAt') return '2026-11-13T12:00:00Z';
    return { value: null };
  },
});

const deps = (items: Array<{ summary: string; content: unknown; privacyClass: string }>, evidence?: () => unknown[]) => ({
  events: { emit: async () => undefined },
  clock: { epochMs: () => Date.parse('2026-11-13T12:00:00Z'), nowIso: () => '2026-11-13T12:00:00Z' },
  ids: { ulid: () => 'context' },
  availableCapabilities: () => [],
  state: { view: () => emptyState() },
  eventStore: { readRecent: async () => [] },
  evidence: evidence ?? (() => items.map((item, index) => ({ ...item, provenance: { index } }))),
}) as unknown as ContextCompilerDeps;

const compile = (instance: ContextCompiler, ceiling: 'PUBLIC' | 'INTERNAL') =>
  instance.compile({ principalId: 'owner', correlationId: 'audit', intent: 'synthetic audit', intentClass: 'reason', budgetUnits: 4000, maxPrivacyClass: ceiling, evidenceRef: 'synthetic' });

describe('cloud context ceiling', () => {
  it('refuses a package that would require restricted evidence, rather than trimming it', async () => {
    const instance = new ContextCompiler(deps([
      { summary: 'public note', content: { text: 'harmless' }, privacyClass: 'PUBLIC' },
      { summary: 'private record', content: { record: SENTINEL }, privacyClass: 'RESTRICTED' },
    ]));
    // Refusal is the correct outcome: silently sending a partial package would leave the
    // model answering from incomplete facts, and silently sending the whole one would leak.
    await expect(compile(instance, 'INTERNAL')).rejects.toThrow('required evidence exceeds privacy ceiling');
  });

  it('allows an eligible package and reports the class it actually used', async () => {
    const instance = new ContextCompiler(deps([{ summary: 'public note', content: { text: 'harmless' }, privacyClass: 'PUBLIC' }]));
    const package_ = await compile(instance, 'INTERNAL');
    expect(JSON.stringify(package_.items)).toContain('harmless');
    expect(JSON.stringify(package_.items)).not.toContain(SENTINEL);
    expect(package_.maxPrivacyClass).toBe('PUBLIC');
  });

  it('a PUBLIC ceiling cannot include INTERNAL material', async () => {
    const instance = new ContextCompiler(deps([{ summary: 'internal note', content: { text: 'internal-only' }, privacyClass: 'INTERNAL' }]));
    await expect(compile(instance, 'PUBLIC')).rejects.toThrow('privacy ceiling');
  });
});

describe('evidence source is only read when a reference exists', () => {
  it('does not call the evidence source without evidenceRef', async () => {
    const evidence = vi.fn(() => []);
    const instance = new ContextCompiler(deps([], evidence));
    await instance.compile({ principalId: 'owner', correlationId: 'c', intent: 'hi', intentClass: 'reason', budgetUnits: 1000, maxPrivacyClass: 'INTERNAL' });
    expect(evidence).not.toHaveBeenCalled();
  });
});
