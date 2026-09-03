import type { AuthorityToken } from '@jarvis/contracts';
export interface TokenCache { put(token: AuthorityToken): Promise<void>; consume(value: string, now: string): Promise<AuthorityToken | undefined>; }
export class MemoryTokenCache implements TokenCache {
  private readonly tokens = new Map<string, AuthorityToken>();
  async put(token: AuthorityToken) { this.tokens.set(token.token, token); }
  async consume(value: string, now: string) { const token = this.tokens.get(value); this.tokens.delete(value); return token && Date.parse(token.expiresAt) > Date.parse(now) ? token : undefined; }
}
