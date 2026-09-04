import { randomUUID } from 'node:crypto';
import type { Sql } from '@jarvis/persistence';
export interface ResourceLeasePort { acquire(resource: string, invocation: string, ttlMs?: number): Promise<boolean>; heartbeat?(resource: string, invocation: string, ttlMs?: number): Promise<boolean>; release(resource: string, invocation: string): Promise<void>; }
export class ResourceLeaseManager implements ResourceLeasePort {
  private readonly held = new Map<string, string>();
  async acquire(resource: string, invocation: string) { if (this.held.has(resource)) return false; this.held.set(resource, invocation); return true; }
  async heartbeat(resource: string, invocation: string) { return this.held.get(resource) === invocation; }
  async release(resource: string, invocation: string) { if (this.held.get(resource) === invocation) this.held.delete(resource); }
}
export class PgResourceLeaseManager implements ResourceLeasePort {
  constructor(private readonly sql: Sql, private readonly ownerId: string, private readonly now = () => new Date()) {}
  async acquire(resource: string, invocation: string, ttlMs = 120_000) {
    const now = this.now(); const expiresAt = new Date(now.getTime() + Math.max(ttlMs, 30_000)); const leaseId = randomUUID();
    return this.sql.begin(async (tx) => {
      const invocations = await tx<{ state: string; grant_id: string | null; grant_version: number | null }[]>`select state, grant_id, grant_version from agency.invocations where invocation_id=${invocation} for update`;
      const current = invocations[0]; if (!current || !['APPROVED','SIMULATED','INTERRUPTED'].includes(current.state) || !current.grant_id || current.grant_version === null) return false;
      const grants = await tx<{ version: number; revoked_at: string | null; expires_at: string | null }[]>`select version, revoked_at, expires_at from agency.grants where id=${current.grant_id} for update`;
      const grant = grants[0]; if (!grant || grant.version !== current.grant_version || grant.revoked_at || (grant.expires_at && Date.parse(grant.expires_at) <= now.getTime())) return false;
      const rows = await tx<{ lease_id: string }[]>`insert into agency.resource_leases (resource_key, invocation_id, acquired_at, expires_at, lease_id, owner_id, heartbeat_at, version) values (${resource}, ${invocation}, ${now.toISOString()}, ${expiresAt.toISOString()}, ${leaseId}, ${this.ownerId}, ${now.toISOString()}, 1) on conflict (resource_key) do update set invocation_id=excluded.invocation_id, acquired_at=excluded.acquired_at, expires_at=excluded.expires_at, lease_id=excluded.lease_id, owner_id=excluded.owner_id, heartbeat_at=excluded.heartbeat_at, version=agency.resource_leases.version+1 where agency.resource_leases.expires_at<=${now.toISOString()} returning lease_id`;
      if (!rows[0]) return false;
      await tx`update agency.invocations set state='LEASE_ACQUIRED', lease_id=${rows[0].lease_id}, resource_key=${resource}, attempt_count=attempt_count+1 where invocation_id=${invocation}`;
      return true;
    });
  }
  async heartbeat(resource: string, invocation: string, ttlMs = 120_000) { const now = this.now(); const rows = await this.sql<{ resource_key: string }[]>`update agency.resource_leases set heartbeat_at=${now.toISOString()}, expires_at=${new Date(now.getTime()+Math.max(ttlMs,30_000)).toISOString()} where resource_key=${resource} and invocation_id=${invocation} and owner_id=${this.ownerId} and expires_at>${now.toISOString()} returning resource_key`; return rows.length === 1; }
  async release(resource: string, invocation: string) { await this.sql`delete from agency.resource_leases where resource_key=${resource} and invocation_id=${invocation} and owner_id=${this.ownerId}`; }
}
