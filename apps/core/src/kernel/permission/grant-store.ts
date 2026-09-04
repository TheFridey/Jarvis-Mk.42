import type { Grant } from '@jarvis/contracts';
import type { Sql } from '@jarvis/persistence';
export interface GrantStore { get(id: string): Promise<Grant | undefined>; put(grant: Grant): Promise<void>; }
export class MemoryGrantStore implements GrantStore {
  private readonly grants = new Map<string, Grant>();
  async get(id: string) { return this.grants.get(id); }
  async put(grant: Grant) { this.grants.set(grant.id, structuredClone(grant)); }
}

interface GrantRow { id: string; principal_id: string; holder_kind: Grant['holder']['kind']; holder_id: string; scopes: string[]; max_risk_without_live_approval: Grant['maxRiskWithoutLiveApproval']; may_proceed_without_live_approval: boolean; resource_constraints: Grant['resourceConstraints']; node_constraints: string[]; time_windows: Grant['timeWindows']; version: number; issued_at: string; expires_at: string | null; revoked_at: string | null; }
export class PgGrantStore implements GrantStore {
  constructor(private readonly sql: Sql) {}
  async get(id: string) { const rows = await this.sql<GrantRow[]>`select * from agency.grants where id=${id} limit 1`; return rows[0] ? this.map(rows[0]) : undefined; }
  async put(grant: Grant) { await this.sql`insert into agency.grants (id, principal_id, holder_kind, holder_id, scopes, max_risk_without_live_approval, may_proceed_without_live_approval, resource_constraints, node_constraints, time_windows, version, issued_at, expires_at, revoked_at) values (${grant.id}, ${grant.principalId}, ${grant.holder.kind}, ${grant.holder.id}, ${grant.scopes}, ${grant.maxRiskWithoutLiveApproval}, ${grant.mayProceedWithoutLiveApproval}, ${JSON.stringify(grant.resourceConstraints)}, ${grant.nodeConstraints}, ${JSON.stringify(grant.timeWindows)}, ${grant.version}, ${grant.issuedAt}, ${grant.expiresAt ?? null}, ${grant.revokedAt ?? null}) on conflict (id) do update set scopes=excluded.scopes, max_risk_without_live_approval=excluded.max_risk_without_live_approval, may_proceed_without_live_approval=excluded.may_proceed_without_live_approval, resource_constraints=excluded.resource_constraints, node_constraints=excluded.node_constraints, time_windows=excluded.time_windows, version=excluded.version, expires_at=excluded.expires_at, revoked_at=excluded.revoked_at`; }
  async findActive(principalId: string, scopes: string[], now: string): Promise<Grant | undefined> { const rows = await this.sql<GrantRow[]>`select * from agency.grants where principal_id=${principalId} and revoked_at is null and (expires_at is null or expires_at > ${now}) and scopes @> ${scopes}::text[] order by version desc limit 1`; return rows[0] ? this.map(rows[0]) : undefined; }
  private map(row: GrantRow): Grant { return { id: row.id, principalId: row.principal_id, holder: { kind: row.holder_kind, id: row.holder_id }, scopes: row.scopes, maxRiskWithoutLiveApproval: row.max_risk_without_live_approval, mayProceedWithoutLiveApproval: row.may_proceed_without_live_approval, resourceConstraints: row.resource_constraints, nodeConstraints: row.node_constraints, timeWindows: row.time_windows, version: row.version, issuedAt: new Date(row.issued_at).toISOString(), ...(row.expires_at ? { expiresAt: new Date(row.expires_at).toISOString() } : {}), ...(row.revoked_at ? { revokedAt: new Date(row.revoked_at).toISOString() } : {}) }; }
}
