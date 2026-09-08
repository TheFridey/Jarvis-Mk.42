import { readFileSync, readdirSync } from 'node:fs'; import { resolve, join } from 'node:path'; import { describe, expect, it } from 'vitest';

const SOURCE_EXT = /\.(?:ts|tsx|js|mjs)$/;

function listSourceFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [resolve(root)];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (SOURCE_EXT.test(entry.name)) out.push(full);
    }
  }
  return out;
}

describe('agency boundary sweep', () => {
  it('keeps adapter imports out of Kernel source', () => { const source = readFileSync(resolve('apps/core/src/kernel/executor/executor.ts'), 'utf8'); expect(source).not.toMatch(/capabilities\//); });
  it('keeps raw input out of the invocation schema', () => { const migration = readFileSync(resolve('packages/persistence/src/migrations/0008_agency.sql'), 'utf8'); const table = migration.match(/create table agency\.invocations \(([\s\S]*?)\n\);/)?.[1] ?? ''; expect(table).toContain('input_hash'); expect(table).not.toMatch(/\binput\s/); });
  it('keeps secret material out of credential grant persistence', () => { const migration = readFileSync(resolve('packages/persistence/src/migrations/0008_agency.sql'), 'utf8'); const table = migration.match(/create table agency\.credential_grants \(([\s\S]*?)\n\);/)?.[1] ?? ''; expect(table).not.toMatch(/secret|token|material/); });
  it('prevents desktop and agents from importing adapters or the Adapter Host', () => { const files = [...listSourceFiles('apps/desktop'), ...listSourceFiles('agents')]; const source = files.map((file) => readFileSync(file, 'utf8')).join('\n'); expect(source).not.toMatch(/@jarvis\/adapter-host|capabilities\//); });
  it('keeps the Adapter Host invocation seam owned by the Executor subsystem', () => { const files = listSourceFiles('apps').map((file) => resolve(file).replaceAll('\\', '/')).filter((file) => readFileSync(file, 'utf8').includes('@jarvis/adapter-host')); const relative = files.map((file) => file.slice(resolve('.').replaceAll('\\', '/').length + 1)).filter((file) => !file.endsWith('boundary-sweep.test.ts') && !file.endsWith('kernel.ts')); expect(relative).toEqual(['apps/core/src/kernel/executor/hosted-adapter.ts']); });
});
