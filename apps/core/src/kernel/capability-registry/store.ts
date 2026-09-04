import type { Capability } from '@jarvis/contracts';
import type { Sql } from '@jarvis/persistence';
export interface StoredCapability { manifest: Capability; artifactHash: string; registeredBy: string; probation: boolean; active: boolean; }
export interface CapabilityStore { put(record: StoredCapability): Promise<void>; get(id: string, version?: string): Promise<StoredCapability | undefined>; versions(id: string): Promise<StoredCapability[]>; }
export class MemoryCapabilityStore implements CapabilityStore {
  private readonly rows = new Map<string, StoredCapability>();
  async put(record: StoredCapability) { this.rows.set(`${record.manifest.id}@${record.manifest.version}`, structuredClone(record)); }
  async get(id: string, version?: string) { const rows = await this.versions(id); return version ? rows.find((r) => r.manifest.version === version) : rows.at(-1); }
  async versions(id: string) { return [...this.rows.values()].filter((r) => r.manifest.id === id).sort((a, b) => a.manifest.version.localeCompare(b.manifest.version, undefined, { numeric: true })); }
}

interface CapabilityRow { manifest: Capability; adapter_artifact_hash: string; registered_by: string; probation: boolean; active: boolean; }
export class PgCapabilityStore implements CapabilityStore {
  constructor(private readonly sql: Sql) {}
  async put(record: StoredCapability) {
    await this.sql`
      insert into agency.capabilities (id, latest_version, description, provider, execution_environment, trust_tier_min, audit_policy, privacy_requirements, active)
      values (${record.manifest.id}, ${record.manifest.version}, ${record.manifest.description}, ${record.manifest.provider}, ${record.manifest.executionEnvironment}, ${record.manifest.trustTierMin}, ${JSON.stringify(record.manifest.auditPolicy)}, ${JSON.stringify(record.manifest.privacyRequirements)}, ${record.active})
      on conflict (id) do update set latest_version=excluded.latest_version, description=excluded.description, provider=excluded.provider, execution_environment=excluded.execution_environment, trust_tier_min=excluded.trust_tier_min, audit_policy=excluded.audit_policy, privacy_requirements=excluded.privacy_requirements, active=excluded.active`;
    await this.sql`
      insert into agency.capability_versions (capability_id, version, manifest, adapter_artifact_hash, registered_by, probation, active)
      values (${record.manifest.id}, ${record.manifest.version}, ${JSON.stringify(record.manifest)}, ${record.artifactHash}, ${record.registeredBy}, ${record.probation}, ${record.active})
      on conflict (capability_id, version) do update set manifest=excluded.manifest, adapter_artifact_hash=excluded.adapter_artifact_hash, registered_by=excluded.registered_by, probation=excluded.probation, active=excluded.active`;
  }
  async get(id: string, version?: string) {
    const rows = version
      ? await this.sql<CapabilityRow[]>`select manifest, adapter_artifact_hash, registered_by, probation, active from agency.capability_versions where capability_id=${id} and version=${version} limit 1`
      : await this.sql<CapabilityRow[]>`select manifest, adapter_artifact_hash, registered_by, probation, active from agency.capability_versions where capability_id=${id} order by registered_at desc limit 1`;
    return rows[0] ? this.map(rows[0]) : undefined;
  }
  async versions(id: string) {
    const rows = await this.sql<CapabilityRow[]>`select manifest, adapter_artifact_hash, registered_by, probation, active from agency.capability_versions where capability_id=${id} order by registered_at asc`;
    return rows.map((row) => this.map(row));
  }
  private map(row: CapabilityRow): StoredCapability { return { manifest: row.manifest, artifactHash: row.adapter_artifact_hash, registeredBy: row.registered_by, probation: row.probation, active: row.active }; }
}
