import { createHmac, randomUUID } from 'node:crypto';
import type { CredentialHandle } from '@jarvis/contracts';
import type { CredentialMaterialStore } from './material-store.ts';
export interface InternalCredential { readOnly: boolean; signRequest: (body: string) => string; use?: <T>(fn: (secret: string) => T) => T; }
interface Entry { handle: CredentialHandle; credential: InternalCredential; used: boolean; }
export class CredentialBroker {
  private readonly handles = new Map<string, Entry>();
  constructor(private readonly material: CredentialMaterialStore, private readonly now = () => new Date().toISOString()) {}
  async mint(input: { invocationId: string; capabilityId: string; action: string; resourceRef: string; mode: 'dry-run' | 'full' }): Promise<CredentialHandle> {
    const provider = input.capabilityId.replace('capabilities.', ''); const secret = await this.material.get(provider) ?? randomUUID();
    const handle: CredentialHandle = { handleId: randomUUID(), invocationId: input.invocationId, scope: { capabilityId: input.capabilityId, action: input.action, resourceRef: input.resourceRef },
      mode: input.mode, expiresAt: new Date(Date.parse(this.now()) + 120_000).toISOString(), kind: provider === 'github' || provider === 'docker' ? 'derived' : 'wrapped-static' };
    const credential: InternalCredential = { readOnly: input.mode === 'dry-run', signRequest: (body) => createHmac('sha256', secret).update(`${handle.handleId}:${body}`).digest('hex'),
      ...(handle.kind === 'wrapped-static' ? { use: <T>(fn: (value: string) => T) => fn(secret) } : {}) };
    this.handles.set(handle.handleId, { handle, credential, used: false }); return handle;
  }
  redeem(handleId: string, invocationId?: string): InternalCredential { const entry = this.handles.get(handleId); if (!entry || entry.used || Date.parse(entry.handle.expiresAt) <= Date.parse(this.now()) || (invocationId && entry.handle.invocationId !== invocationId)) throw new Error('invalid or expired credential handle'); entry.used = true; return entry.credential; }
  async revoke(handleId: string) { this.handles.delete(handleId); }
}
