import type { Grant } from '@jarvis/contracts';
export interface GrantStore { get(id: string): Promise<Grant | undefined>; put(grant: Grant): Promise<void>; }
export class MemoryGrantStore implements GrantStore {
  private readonly grants = new Map<string, Grant>();
  async get(id: string) { return this.grants.get(id); }
  async put(grant: Grant) { this.grants.set(grant.id, structuredClone(grant)); }
}
