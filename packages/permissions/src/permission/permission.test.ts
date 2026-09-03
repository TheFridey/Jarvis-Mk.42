import { expect, it } from 'vitest';
import { checkResourceConstraints } from './constraints.ts';
import { mintAuthorityToken } from './token.ts';
it('rejects resources outside a path grant', () => expect(checkResourceConstraints([{ kind: 'path-prefix', value: '/ws' }], { path: '/etc/passwd' }, 'write').ok).toBe(false));
it('binds a token for 120 seconds', () => { const t = mintAuthorityToken({ invocationId: 'i', grantId: 'g', grantVersion: 1, principalId: 'p', scopes: [], mode: 'full', now: '2026-09-03T00:00:00.000Z' }); expect(Date.parse(t.expiresAt) - Date.parse(t.issuedAt)).toBe(120000); });
