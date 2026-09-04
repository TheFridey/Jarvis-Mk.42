import { readFileSync } from 'node:fs'; import { resolve } from 'node:path'; import { describe, expect, it } from 'vitest';
describe('agency boundary sweep', () => {
  it('keeps adapter imports out of Kernel source', () => { const source = readFileSync(resolve('apps/core/src/kernel/executor/executor.ts'), 'utf8'); expect(source).not.toMatch(/capabilities\//); });
  it('keeps raw input out of the invocation schema', () => { const migration = readFileSync(resolve('packages/persistence/src/migrations/0008_agency.sql'), 'utf8'); const table = migration.match(/create table agency\.invocations \(([\s\S]*?)\n\);/)?.[1] ?? ''; expect(table).toContain('input_hash'); expect(table).not.toMatch(/\binput\s/); });
  it('keeps secret material out of credential grant persistence', () => { const migration = readFileSync(resolve('packages/persistence/src/migrations/0008_agency.sql'), 'utf8'); const table = migration.match(/create table agency\.credential_grants \(([\s\S]*?)\n\);/)?.[1] ?? ''; expect(table).not.toMatch(/secret|token|material/); });
});
