import { randomBytes } from 'node:crypto';
import type { AuthorityToken } from '@jarvis/contracts';
export function mintAuthorityToken(params: Omit<AuthorityToken, 'token' | 'issuedAt' | 'expiresAt'> & { now: string }): AuthorityToken {
  return { token: randomBytes(32).toString('base64url'), invocationId: params.invocationId, grantId: params.grantId,
    grantVersion: params.grantVersion, principalId: params.principalId, scopes: params.scopes, mode: params.mode,
    issuedAt: params.now, expiresAt: new Date(Date.parse(params.now) + 120_000).toISOString() };
}
