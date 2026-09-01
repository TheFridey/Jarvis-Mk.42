/**
 * PostgreSQL access for the Identity Manager (identity schema).
 */
import type { Sql } from '@jarvis/persistence';
import type { Identity, IdentityKind, Principal, TrustLevel } from '@jarvis/contracts';

interface PrincipalRow {
  id: string;
  display_name: string;
  is_operator: boolean;
  created_at: string;
  disabled_at: string | null;
}
interface IdentityRow {
  id: string;
  kind: string;
  principal_id: string;
  external_ref: string;
  display_name: string;
  trust: string;
  created_at: string;
  revoked_at: string | null;
}

export class IdentityStore {
  constructor(private readonly sql: Sql) {}

  async upsertPrincipal(p: Principal): Promise<void> {
    await this.sql`
      insert into identity.principals (id, display_name, is_operator, created_at)
      values (${p.id}, ${p.displayName}, ${p.isOperator}, ${p.createdAt})
      on conflict (id) do update set display_name = excluded.display_name,
                                     is_operator = excluded.is_operator`;
  }

  async getPrincipal(id: string): Promise<Principal | null> {
    const rows = await this.sql<PrincipalRow[]>`
      select * from identity.principals where id = ${id} limit 1`;
    const r = rows[0];
    return r
      ? {
          id: r.id,
          displayName: r.display_name,
          isOperator: r.is_operator,
          createdAt: r.created_at,
          ...(r.disabled_at ? { disabledAt: r.disabled_at } : {}),
        }
      : null;
  }

  async upsertIdentity(i: Identity): Promise<void> {
    await this.sql`
      insert into identity.identities
        (id, kind, principal_id, external_ref, display_name, trust, created_at)
      values (${i.id}, ${i.kind}, ${i.principalId}, ${i.externalRef}, ${i.displayName}, ${i.trust}, ${i.createdAt})
      on conflict (id) do update set trust = excluded.trust,
                                     display_name = excluded.display_name`;
  }

  async findIdentity(kind: IdentityKind, externalRef: string): Promise<Identity | null> {
    const rows = await this.sql<IdentityRow[]>`
      select * from identity.identities
      where kind = ${kind} and external_ref = ${externalRef} limit 1`;
    const r = rows[0];
    return r ? this.toIdentity(r) : null;
  }

  async getIdentity(id: string): Promise<Identity | null> {
    const rows = await this.sql<IdentityRow[]>`
      select * from identity.identities where id = ${id} limit 1`;
    return rows[0] ? this.toIdentity(rows[0]) : null;
  }

  async setTrust(id: string, trust: TrustLevel): Promise<void> {
    await this.sql`update identity.identities set trust = ${trust} where id = ${id}`;
  }

  async revoke(id: string, atIso: string): Promise<void> {
    await this.sql`update identity.identities set revoked_at = ${atIso} where id = ${id}`;
  }

  async setCredential(identityId: string, method: string, secretHash: string): Promise<void> {
    await this.sql`
      insert into identity.credentials (identity_id, method, secret_hash)
      values (${identityId}, ${method}, ${secretHash})
      on conflict (identity_id, method) do update set secret_hash = excluded.secret_hash`;
  }

  async getCredential(identityId: string, method: string): Promise<string | null> {
    const rows = await this.sql<{ secret_hash: string }[]>`
      select secret_hash from identity.credentials
      where identity_id = ${identityId} and method = ${method} limit 1`;
    return rows[0]?.secret_hash ?? null;
  }

  private toIdentity(r: IdentityRow): Identity {
    return {
      id: r.id,
      kind: r.kind as IdentityKind,
      principalId: r.principal_id,
      externalRef: r.external_ref,
      displayName: r.display_name,
      trust: r.trust as TrustLevel,
      createdAt: r.created_at,
      ...(r.revoked_at ? { revokedAt: r.revoked_at } : {}),
    };
  }
}
