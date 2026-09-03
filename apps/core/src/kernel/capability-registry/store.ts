import type { Capability } from '@jarvis/contracts';
export interface StoredCapability { manifest: Capability; artifactHash: string; registeredBy: string; probation: boolean; active: boolean; }
export interface CapabilityStore { put(record: StoredCapability): Promise<void>; get(id: string, version?: string): Promise<StoredCapability | undefined>; versions(id: string): Promise<StoredCapability[]>; }
export class MemoryCapabilityStore implements CapabilityStore {
  private readonly rows = new Map<string, StoredCapability>();
  async put(record: StoredCapability) { this.rows.set(`${record.manifest.id}@${record.manifest.version}`, structuredClone(record)); }
  async get(id: string, version?: string) { const rows = await this.versions(id); return version ? rows.find((r) => r.manifest.version === version) : rows.at(-1); }
  async versions(id: string) { return [...this.rows.values()].filter((r) => r.manifest.id === id).sort((a, b) => a.manifest.version.localeCompare(b.manifest.version, undefined, { numeric: true })); }
}
