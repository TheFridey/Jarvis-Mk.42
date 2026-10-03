import { createHmac, randomUUID } from 'node:crypto';
import type { AuthorityToken, CredentialHandle } from '@jarvis/contracts';
import type { CredentialMaterialStore } from './material-store.ts';
import type { Sql } from '@jarvis/persistence';
export interface InternalCredential { principalId?: string; readOnly: boolean; signRequest: (body: string) => string; use?: <T>(fn: (secret: string) => T) => T; }
interface Entry { handle: CredentialHandle; credential: InternalCredential; used: boolean; }
export class CredentialUnavailableError extends Error {}
export interface AuthorityTokenConsumer { consume(value: string, now: string): Promise<AuthorityToken | undefined>; }
export class CredentialBroker {
  private readonly handles = new Map<string, Entry>();
  constructor(private readonly material: CredentialMaterialStore, private readonly tokens: AuthorityTokenConsumer, private readonly now = () => new Date().toISOString(), private readonly sql?: Sql) {}
  async mint(input: { authorityToken: string; invocationId: string; capabilityId: string; action: string; resourceRef: string; mode: 'dry-run' | 'full'; kind?: CredentialHandle['kind']; ttlMs?: number }): Promise<CredentialHandle> {
    const authority = await this.tokens.consume(input.authorityToken, this.now());
    if (!authority || Date.parse(authority.expiresAt) <= Date.parse(this.now()) || authority.invocationId !== input.invocationId || authority.mode !== input.mode) throw new Error('invalid, expired, or mismatched authority token');
    const provider = input.capabilityId.replace('capabilities.', '');
    const kind = input.kind ?? 'wrapped-static';
    const material = kind === 'none' ? '' : await this.material.get(provider);
    if (kind !== 'none' && !material) throw new CredentialUnavailableError(`credential material unavailable for ${provider}`);
    const secret = material ?? '';
    const handle: CredentialHandle = { handleId: randomUUID(), invocationId: input.invocationId, scope: { capabilityId: input.capabilityId, action: input.action, resourceRef: input.resourceRef },
      mode: input.mode, expiresAt: new Date(Date.parse(this.now()) + (input.ttlMs ?? 120_000)).toISOString(), kind };
    const credential: InternalCredential = { principalId: authority.principalId, readOnly: input.mode === 'dry-run', signRequest: (body) => createHmac('sha256', secret).update(`${handle.handleId}:${body}`).digest('hex'),
      ...(handle.kind === 'wrapped-static' ? { use: <T>(fn: (value: string) => T) => fn(secret) } : {}) };
    this.handles.set(handle.handleId, { handle, credential, used: false });
    if (this.sql) await this.sql`insert into agency.credential_grants (id, invocation_id, handle_id, scope, mode, kind, minted_at, expires_at) values (${randomUUID()}, ${handle.invocationId}, ${handle.handleId}, ${JSON.stringify(handle.scope)}, ${handle.mode}, ${handle.kind}, ${this.now()}, ${handle.expiresAt})`;
    return handle;
  }
  redeem(handleId: string, invocationId?: string): InternalCredential { const entry = this.handles.get(handleId); if (!entry || entry.used || Date.parse(entry.handle.expiresAt) <= Date.parse(this.now()) || (invocationId && entry.handle.invocationId !== invocationId)) throw new Error('invalid or expired credential handle'); entry.used = true; return entry.credential; }
  async revoke(handleId: string) { this.handles.delete(handleId); if (this.sql) await this.sql`update agency.credential_grants set revoked_at=${this.now()} where handle_id=${handleId} and revoked_at is null`; }
}
