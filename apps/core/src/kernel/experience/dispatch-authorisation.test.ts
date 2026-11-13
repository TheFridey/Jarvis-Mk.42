import { describe, expect, it } from 'vitest';
import {
  CONVERSATION_POLICY_VERSION,
  verifyBeforeDispatch,
  type AuthorisationRef,
  type ConversationGrant,
} from './conversation-privacy.ts';

/**
 * The window this file covers: between "this turn is allowed" and "the request leaves".
 * A grant can be revoked inside that window, and the second read is what makes that real.
 */

const NOW = Date.parse('2026-11-13T12:00:00.000Z');
const ref: AuthorisationRef = { grantId: 'grant-1', conversationId: 'conv-1', provider: 'openrouter' };

const grant = (patch: Partial<ConversationGrant> = {}): ConversationGrant => ({
  grantId: 'grant-1',
  conversationId: 'conv-1',
  principalId: 'owner',
  provider: 'openrouter',
  model: 'deepseek/deepseek-v4.1-flash-1017',
  purpose: 'conversation',
  ceiling: 'INTERNAL',
  policyVersion: CONVERSATION_POLICY_VERSION,
  createdAt: '2026-11-13T11:59:00.000Z',
  expiresAt: null,
  revokedAt: null,
  ...patch,
});

const check = (loaded: ConversationGrant | null, given: AuthorisationRef | undefined = ref) =>
  verifyBeforeDispatch(async () => loaded, given, NOW);

describe('pre-dispatch authorisation', () => {
  it('allows a live grant that matches the reference', async () => {
    await expect(check(grant())).resolves.toEqual({ ok: true });
  });

  it('refuses when the grant was deleted or never written', async () => {
    await expect(check(null)).resolves.toMatchObject({ ok: false, reason: 'no_grant' });
  });

  it('refuses a cloud dispatch that carries no reference at all', async () => {
    await expect(verifyBeforeDispatch(async () => grant(), undefined, NOW)).resolves.toMatchObject({ ok: false, reason: 'no_grant' });
  });

  it('19. refuses when revocation lands between acceptance and dispatch', async () => {
    // First read: the grant is live, so the turn is accepted.
    let revoked = false;
    const load = async () => grant(revoked ? { revokedAt: '2026-11-13T11:59:30.000Z' } : {});
    await expect(verifyBeforeDispatch(load, ref, NOW)).resolves.toEqual({ ok: true });
    // The operator revokes while the context is being compiled.
    revoked = true;
    await expect(verifyBeforeDispatch(load, ref, NOW)).resolves.toMatchObject({ ok: false, reason: 'revoked' });
  });

  it('refuses an expiry that lands in the same window', async () => {
    await expect(check(grant({ expiresAt: '2026-11-13T11:59:59.000Z' }))).resolves.toMatchObject({ ok: false, reason: 'expired' });
  });

  it('refuses provider substitution between acceptance and dispatch', async () => {
    await expect(check(grant({ provider: 'anthropic' }))).resolves.toMatchObject({ ok: false, reason: 'provider_mismatch' });
    await expect(check(grant(), { ...ref, provider: 'anthropic' })).resolves.toMatchObject({ ok: false, reason: 'provider_mismatch' });
  });

  it('refuses a grant for another conversation', async () => {
    await expect(check(grant({ conversationId: 'conv-2' }))).resolves.toMatchObject({ ok: false, reason: 'conversation_mismatch' });
  });

  it('refuses a policy-version downgrade', async () => {
    await expect(check(grant({ policyVersion: CONVERSATION_POLICY_VERSION - 1 }))).resolves.toMatchObject({ ok: false, reason: 'policy_version_mismatch' });
  });

  it('refuses a ceiling that cloud may not use', async () => {
    await expect(check(grant({ ceiling: 'SENSITIVE' }))).resolves.toMatchObject({ ok: false, reason: 'ceiling_above_cloud' });
  });

  it('refuses an unreadable expiry rather than assuming it is valid', async () => {
    await expect(check(grant({ expiresAt: 'soon' }))).resolves.toMatchObject({ ok: false, reason: 'expired' });
  });

  it('refuses a stored grant whose id does not match the reference', async () => {
    await expect(verifyBeforeDispatch(async () => grant({ grantId: 'grant-9' }), ref, NOW))
      .resolves.toMatchObject({ ok: false, reason: 'malformed_grant' });
  });
});
