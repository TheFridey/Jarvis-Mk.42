import { describe, expect, it } from 'vitest';
import { PrincipalResolutionError, principalsInRegistry, resolveMemoryPrincipal } from './principal-resolution.ts';

/**
 * Principal resolution.
 *
 * The regression this locks down: the resolver asked `nodes.registry` for `created_at` and for a
 * `node_type = 'display'` row. Neither exists — the table has `enrolled_at`, and the owner's row is
 * the `server` node — so the CLI crashed and, before that, silently wrote memories under a
 * principal the Kernel never served.
 */

type Rows = { principal_id: string }[];

const fakeSql = (rows: Rows | Error) => {
  const calls: string[] = [];
  const sql = (async (strings: TemplateStringsArray) => {
    calls.push(strings.join('?'));
    if (rows instanceof Error) throw rows;
    return rows;
  }) as never;
  return { sql, calls };
};

const env = (values: Record<string, string | undefined>) => values as NodeJS.ProcessEnv;

describe('principal resolution', () => {
  it('honours an explicit principal without touching the database', async () => {
    const { sql, calls } = fakeSql(new Error('should not be queried'));
    const resolved = await resolveMemoryPrincipal(sql, env({ JARVIS_PRINCIPAL_ID: 'principal-operator' }));
    expect(resolved).toEqual({ principalId: 'principal-operator', source: 'environment' });
    expect(calls).toEqual([]);
  });

  it('resolves the single live principal from the registry', async () => {
    const { sql } = fakeSql([{ principal_id: 'principal-operator' }]);
    const resolved = await resolveMemoryPrincipal(sql, env({}));
    expect(resolved).toEqual({ principalId: 'principal-operator', source: 'registry' });
  });

  it('queries only columns that exist in nodes.registry', async () => {
    const { sql, calls } = fakeSql([]);
    await principalsInRegistry(sql);
    const query = calls[0] ?? '';
    expect(query).toContain('principal_id');
    expect(query).toContain('status');
    expect(query).toContain('revoked_at');
    // Both of these were the defect: neither column nor node type exists for the owner's node.
    expect(query).not.toContain('created_at');
    expect(query).not.toContain('display');
  });

  it('refuses to guess when several principals are registered', async () => {
    const { sql } = fakeSql([{ principal_id: 'alpha' }, { principal_id: 'beta' }]);
    await expect(resolveMemoryPrincipal(sql, env({}))).rejects.toBeInstanceOf(PrincipalResolutionError);
    await expect(resolveMemoryPrincipal(sql, env({}))).rejects.toThrow(/names 2 principals .*alpha, beta.*refusing to guess/);
  });

  it('fails loudly with an empty registry rather than inventing an identity', async () => {
    const { sql } = fakeSql([]);
    await expect(resolveMemoryPrincipal(sql, env({}))).rejects.toThrow(/no connected node is registered/);
  });

  it('reports a schema failure as an actionable message', async () => {
    const { sql } = fakeSql(Object.assign(new Error('column "created_at" does not exist'), { code: '42703' }));
    await expect(resolveMemoryPrincipal(sql, env({}))).rejects.toThrow(/could not read the node registry.*JARVIS_PRINCIPAL_ID/s);
  });

  it('treats a blank override as absent', async () => {
    const { sql } = fakeSql([{ principal_id: 'principal-operator' }]);
    const resolved = await resolveMemoryPrincipal(sql, env({ JARVIS_PRINCIPAL_ID: '   ' }));
    expect(resolved.source).toBe('registry');
  });
});
