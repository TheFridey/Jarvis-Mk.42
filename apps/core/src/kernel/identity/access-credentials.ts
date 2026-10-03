import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AuthContext, SessionAccessCredential } from '@jarvis/contracts';
import type { Sql } from '@jarvis/persistence';
import type { Clock } from '../../runtime/clock.ts';
import type { IdGen } from '../../runtime/ids.ts';

export interface AccessCredentialStore {
  insert(record: SessionAccessCredential & { secretHash: string }): Promise<void>;
  find(secretHash: string): Promise<SessionAccessCredential | null>;
  revokeCredential(id: string, at: string): Promise<void>;
  revokeSession(sessionId: string, at: string): Promise<void>;
  revokeIdentity(identityId: string, at: string): Promise<void>;
  revokeNode(nodeId: string, at: string): Promise<void>;
  validity(record: SessionAccessCredential): Promise<{ sessionActive: boolean; identityActive: boolean; principalActive: boolean; nodeActive: boolean }>;
}

const digest = (secret: string) => createHash('sha256').update(secret, 'utf8').digest('hex');

export class SessionCredentialManager {
  constructor(private readonly deps: { store: AccessCredentialStore; clock: Clock; ids: IdGen; ttlMs?: number }) {}

  async issue(input: { identityId: string; principalId: string; sessionId: string; nodeId: string; scopes: string[]; authStrength: SessionAccessCredential['authStrength']; generation?: number }) {
    const secret = randomBytes(32).toString('base64url');
    const issuedAt = this.deps.clock.nowIso();
    const record: SessionAccessCredential = { id: this.deps.ids.ulid(), ...input, scopes: [...new Set(input.scopes)].sort(), issuedAt, expiresAt: new Date(this.deps.clock.epochMs() + (this.deps.ttlMs ?? 15 * 60_000)).toISOString(), generation: input.generation ?? 1 };
    await this.deps.store.insert({ ...record, secretHash: digest(secret) });
    return { accessToken: secret, credential: record };
  }

  async authenticate(bearer: string | undefined, expected: { nodeId: string; sessionId?: string; scopes: string[]; minimumStrength?: SessionAccessCredential['authStrength']; recentWithinMs?: number }): Promise<AuthContext | null> {
    if (!bearer?.startsWith('Bearer ')) return null;
    const secret = bearer.slice(7);
    if (secret.length < 32) return null;
    const candidate = digest(secret);
    const record = await this.deps.store.find(candidate);
    if (!record || record.revokedAt || Date.parse(record.expiresAt) <= this.deps.clock.epochMs()) return null;
    if (!timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(digest(secret), 'hex'))) return null;
    if (record.nodeId !== expected.nodeId || (expected.sessionId && record.sessionId !== expected.sessionId)) return null;
    if (!expected.scopes.every((scope) => record.scopes.includes(scope))) return null;
    const strength = { bootstrap: 0, single_factor: 1, strong: 2 } as const;
    if (expected.minimumStrength && strength[record.authStrength] < strength[expected.minimumStrength]) return null;
    if (expected.recentWithinMs && this.deps.clock.epochMs() - Date.parse(record.issuedAt) > expected.recentWithinMs) return null;
    const live = await this.deps.store.validity(record);
    if (!live.sessionActive || !live.identityActive || !live.principalActive || !live.nodeActive) return null;
    return { identityId: record.identityId, principalId: record.principalId, kind: 'principal', method: 'token', trust: record.authStrength === 'strong' ? 'verified' : 'trusted', nodeId: record.nodeId, sessionId: record.sessionId, scopes: record.scopes, authStrength: record.authStrength, credentialId: record.id, authenticatedAt: this.deps.clock.nowIso(), issuedAt: record.issuedAt, expiresAt: record.expiresAt };
  }

  async rotate(bearer: string, expected: { nodeId: string; sessionId: string; scopes: string[] }) {
    const context = await this.authenticate(bearer, expected); if (!context?.credentialId || !context.sessionId || !context.authStrength) return null;
    const old = await this.deps.store.find(digest(bearer.slice(7))); if (!old) return null;
    const next = await this.issue({ identityId: context.identityId, principalId: context.principalId, sessionId: context.sessionId, nodeId: context.nodeId, scopes: context.scopes ?? [], authStrength: context.authStrength, generation: old.generation + 1 });
    await this.deps.store.revokeCredential(old.id, this.deps.clock.nowIso());
    return next;
  }
}

export class PgAccessCredentialStore implements AccessCredentialStore {
  constructor(private readonly sql: Sql) {}
  async insert(r: SessionAccessCredential & { secretHash: string }) { await this.sql`insert into identity.access_credentials(id,secret_hash,identity_id,principal_id,session_id,node_id,scopes,auth_strength,issued_at,expires_at,generation) values(${r.id},${r.secretHash},${r.identityId},${r.principalId},${r.sessionId},${r.nodeId},${r.scopes},${r.authStrength},${r.issuedAt},${r.expiresAt},${r.generation})`; }
  async find(hash: string) { const rows=await this.sql<any[]>`select * from identity.access_credentials where secret_hash=${hash} limit 1`; const r=rows[0]; return r ? { id:r.id,identityId:r.identity_id,principalId:r.principal_id,sessionId:r.session_id,nodeId:r.node_id,scopes:r.scopes,authStrength:r.auth_strength,issuedAt:new Date(r.issued_at).toISOString(),expiresAt:new Date(r.expires_at).toISOString(),generation:r.generation,...(r.revoked_at?{revokedAt:new Date(r.revoked_at).toISOString()}:{}) } : null; }
  async revokeCredential(id:string,at:string){await this.sql`update identity.access_credentials set revoked_at=${at} where id=${id} and revoked_at is null`;}
  async revokeSession(id:string,at:string){await this.sql`update identity.access_credentials set revoked_at=${at} where session_id=${id} and revoked_at is null`;}
  async revokeIdentity(id:string,at:string){await this.sql`update identity.access_credentials set revoked_at=${at} where identity_id=${id} and revoked_at is null`;}
  async revokeNode(id:string,at:string){await this.sql`update identity.access_credentials set revoked_at=${at} where node_id=${id} and revoked_at is null`;}
  async validity(r:SessionAccessCredential){const [v]=await this.sql<any[]>`select exists(select 1 from session.sessions where id=${r.sessionId} and state<>'ended') session_active,exists(select 1 from identity.identities where id=${r.identityId} and revoked_at is null) identity_active,exists(select 1 from identity.principals where id=${r.principalId} and disabled_at is null) principal_active,(exists(select 1 from nodes.registry where node_id=${r.nodeId} and status not in ('revoked','isolated')) and (${!r.scopes.includes('nodes.declare')} or exists(select 1 from nodes.connections where node_id=${r.nodeId} and session_id=${r.sessionId} and epoch=${r.generation} and connected=true))) node_active`;return{sessionActive:v.session_active,identityActive:v.identity_active,principalActive:v.principal_active,nodeActive:v.node_active};}
}
