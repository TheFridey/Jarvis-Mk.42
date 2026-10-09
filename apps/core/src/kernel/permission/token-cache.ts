import type { AuthorityToken } from '@jarvis/contracts';
import type { Sql } from '@jarvis/persistence';
import { createHash } from 'node:crypto';
export interface TokenCache { put(token: AuthorityToken): Promise<void>; consume(value: string, now: string): Promise<AuthorityToken | undefined>; }
export class MemoryTokenCache implements TokenCache {
  private readonly tokens = new Map<string, AuthorityToken>();
  async put(token: AuthorityToken) { this.tokens.set(token.token, token); }
  async consume(value: string, now: string) { const token = this.tokens.get(value); this.tokens.delete(value); return token && Date.parse(token.expiresAt) > Date.parse(now) ? token : undefined; }
}
interface TokenRow { domain_id: string; invocation_id: string; grant_id: string; grant_version: number; principal_id: string; scopes: string[]; mode: AuthorityToken['mode']; issued_at: string; expires_at: string; }
export class PgTokenCache implements TokenCache {
  constructor(private readonly sql: Sql) {}
  async put(token: AuthorityToken) { await this.sql`insert into agency.authority_tokens (token_hash, invocation_id, grant_id, grant_version, principal_id, scopes, mode, issued_at, expires_at) values (${this.hash(token.token)}, ${token.invocationId}, ${token.grantId}, ${token.grantVersion}, ${token.principalId}, ${token.scopes}, ${token.mode}, ${token.issuedAt}, ${token.expiresAt})`; }
  async consume(value: string, now: string) {
    const rows = await this.sql<TokenRow[]>`update agency.authority_tokens set consumed_at=${now} where token_hash=${this.hash(value)} and consumed_at is null and expires_at>${now} returning domain_id, invocation_id, grant_id, grant_version, principal_id, scopes, mode, issued_at, expires_at`;
    const row = rows[0]; return row ? { domainId: row.domain_id, token: value, invocationId: row.invocation_id, grantId: row.grant_id, grantVersion: row.grant_version, principalId: row.principal_id, scopes: row.scopes, mode: row.mode, issuedAt: new Date(row.issued_at).toISOString(), expiresAt: new Date(row.expires_at).toISOString() } : undefined;
  }
  private hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
}
