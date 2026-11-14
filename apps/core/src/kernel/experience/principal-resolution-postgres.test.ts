import { describe, expect, it } from 'vitest';
import { createPg } from '../../../../../packages/persistence/src/client.ts';
import { principalsInRegistry, resolveMemoryPrincipal } from './principal-resolution.ts';

/**
 * The real schema, the real database.
 *
 * Gated on JARVIS_DB_URL so an offline unit run does not fail; when present, this executes the
 * exact query the CLI runs and proves it against the migrated `nodes.registry`. The previous
 * defect would fail here immediately with `column "created_at" does not exist`.
 */

const url = process.env.JARVIS_DB_URL;
const enabled = Boolean(url);

describe.skipIf(!enabled)('principal resolution against PostgreSQL', () => {
  it('executes against the migrated nodes.registry and returns exactly one principal', async () => {
    const client = createPg({ url: url! });
    try {
      const principals = await principalsInRegistry(client.sql as never);
      expect(principals.length).toBe(1);
      const resolved = await resolveMemoryPrincipal(client.sql as never, {} as NodeJS.ProcessEnv);
      expect(resolved.source).toBe('registry');
      expect(resolved.principalId).toBe(principals[0]);
    } finally {
      await client.close();
    }
  });

  it('records the owner principal the Kernel serves', async () => {
    const client = createPg({ url: url! });
    try {
      const principals = await principalsInRegistry(client.sql as never);
      // Metadata assertion only: the identity, never a memory statement.
      expect(principals).toContain('principal-operator');
    } finally {
      await client.close();
    }
  });
});
