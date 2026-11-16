/**
 * Which principal owns this machine's memory.
 *
 * The Kernel serves conversations under the principal recorded for the enrolled node. The CLI must
 * use that same identity or it writes memories into a namespace no conversation will ever read —
 * which is exactly what happened: 123 approved records under `local-owner` while the Kernel served
 * `principal-operator`.
 *
 * Resolution rules, in order:
 *
 *  1. an explicit `JARVIS_PRINCIPAL_ID` always wins;
 *  2. otherwise the registry must name exactly one live principal;
 *  3. if it names none, or several, resolution fails loudly rather than guessing. Picking one of
 *     several registered principals would be an identity decision, and an identity decision made
 *     silently by a convenience tool is not one an isolation boundary can survive.
 */

type Sql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

export interface PrincipalResolution {
  principalId: string;
  source: 'environment' | 'registry';
}

export class PrincipalResolutionError extends Error {
  constructor(message: string, readonly detail: { reason: 'empty' | 'ambiguous' | 'unavailable'; principals?: string[] }) {
    super(message);
    this.name = 'PrincipalResolutionError';
  }
}

/** Live principals only: revoked and disconnected nodes are not the machine's owner. */
export async function principalsInRegistry(sql: Sql): Promise<string[]> {
  const rows = await sql`
    select distinct principal_id
      from nodes.registry
     where status = 'connected' and revoked_at is null
     order by principal_id`;
  return (rows as { principal_id: string }[]).map(row => row.principal_id);
}

export async function resolveMemoryPrincipal(sql: Sql, env: NodeJS.ProcessEnv = process.env): Promise<PrincipalResolution> {
  const explicit = env.JARVIS_PRINCIPAL_ID?.trim();
  if (explicit) return { principalId: explicit, source: 'environment' };

  let principals: string[];
  try {
    principals = await principalsInRegistry(sql);
  } catch (error) {
    throw new PrincipalResolutionError(
      `could not read the node registry (${(error as Error).message}). Set JARVIS_PRINCIPAL_ID to skip resolution.`,
      { reason: 'unavailable' },
    );
  }

  if (principals.length === 1) return { principalId: principals[0]!, source: 'registry' };
  if (principals.length === 0) {
    throw new PrincipalResolutionError(
      'no connected node is registered, so the owner principal cannot be inferred. Start the Kernel once, or set JARVIS_PRINCIPAL_ID.',
      { reason: 'empty' },
    );
  }
  throw new PrincipalResolutionError(
    `the registry names ${principals.length} principals (${principals.join(', ')}); refusing to guess. Set JARVIS_PRINCIPAL_ID to choose.`,
    { reason: 'ambiguous', principals },
  );
}
