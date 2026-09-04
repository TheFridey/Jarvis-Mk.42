import type { Sql } from '@jarvis/persistence';
export interface ResourceLeasePort { acquire(resource: string, invocation: string, ttlMs?: number): Promise<boolean>; release(resource: string, invocation: string): Promise<void>; }
export class ResourceLeaseManager implements ResourceLeasePort {
  private readonly held = new Map<string, string>();
  async acquire(resource: string, invocation: string) { if (this.held.has(resource)) return false; this.held.set(resource, invocation); return true; }
  async release(resource: string, invocation: string) { if (this.held.get(resource) === invocation) this.held.delete(resource); }
}
export class PgResourceLeaseManager implements ResourceLeasePort {
  constructor(private readonly sql: Sql, private readonly now = () => new Date()) {}
  async acquire(resource: string, invocation: string, ttlMs = 120_000) { const acquiredAt = this.now(); const expiresAt = new Date(acquiredAt.getTime() + ttlMs); const rows = await this.sql<{ resource_key: string }[]>`insert into agency.resource_leases (resource_key, invocation_id, acquired_at, expires_at) values (${resource}, ${invocation}, ${acquiredAt.toISOString()}, ${expiresAt.toISOString()}) on conflict (resource_key) do update set invocation_id=excluded.invocation_id, acquired_at=excluded.acquired_at, expires_at=excluded.expires_at where agency.resource_leases.expires_at <= ${acquiredAt.toISOString()} returning resource_key`; return rows.length === 1; }
  async release(resource: string, invocation: string) { await this.sql`delete from agency.resource_leases where resource_key=${resource} and invocation_id=${invocation}`; }
}
