import type { Capability } from '@jarvis/contracts';
import { validateManifest } from './manifest-validate.ts';
import type { CapabilityStore } from './store.ts';
const risk = ['AMBIENT', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export class CapabilityRegistry {
  constructor(private readonly store: CapabilityStore) {}
  async register(manifest: Capability, artifactHash: string, registeredBy: string) {
    const valid = validateManifest(manifest); if (!valid.ok) return { ok: false as const, code: valid.errors[0]?.code ?? 'INVALID', detail: valid.errors[0]?.detail ?? 'invalid' };
    await this.store.put({ manifest, artifactHash, registeredBy, probation: false, active: true }); return { ok: true as const, version: manifest.version };
  }
  async lookup(id: string, version?: string): Promise<Capability | undefined> { const row = await this.store.get(id, version); if (!row?.active) return undefined; if (!row.probation) return row.manifest;
    return { ...row.manifest, actions: row.manifest.actions.map((action) => ({ ...action, riskClass: risk[Math.max(risk.indexOf(action.riskClass), risk.indexOf('HIGH'))]!, approvalPolicy: 'always' })) };
  }
  async enterProbation(id: string) { const row = await this.store.get(id); if (!row) throw new Error('capability not found'); await this.store.put({ ...row, probation: true }); }
  async clearProbation(id: string) { const row = await this.store.get(id); if (!row) throw new Error('capability not found'); await this.store.put({ ...row, probation: false }); }
}
