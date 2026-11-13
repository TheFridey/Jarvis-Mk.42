import { describe, expect, it } from 'vitest';
import {
  classificationForTurn,
  CONVERSATION_POLICY_VERSION,
  evaluateConversationGrant,
  regimeForGrant,
  type ConversationGrant,
  type ConversationTurn,
} from './conversation-privacy.ts';

/** Synthetic only: conversation identifiers and text carry no real content. */
const NOW = Date.parse('2026-11-13T11:00:00.000Z');
const T = (offsetMinutes: number) => new Date(NOW + offsetMinutes * 60_000).toISOString();

const grant = (patch: Partial<ConversationGrant> = {}): ConversationGrant => ({
  grantId: 'grant-1',
  conversationId: 'conv-1',
  principalId: 'owner',
  provider: 'openrouter',
  model: 'deepseek/deepseek-v4.1-flash-1017',
  purpose: 'conversation',
  ceiling: 'INTERNAL',
  policyVersion: CONVERSATION_POLICY_VERSION,
  createdAt: T(-30),
  expiresAt: null,
  revokedAt: null,
  ...patch,
});

const turn = (patch: Partial<ConversationTurn> = {}): ConversationTurn => ({
  conversationId: 'conv-1',
  principalId: 'owner',
  createdAt: T(-10),
  privacyClass: 'INTERNAL',
  regime: 'CLOUD_PERMITTED',
  ...patch,
});

const evaluate = (input: Partial<Parameters<typeof evaluateConversationGrant>[0]> = {}) =>
  evaluateConversationGrant({ conversationId: 'conv-1', principalId: 'owner', grant: grant(), turns: [], now: NOW, ...input });

describe('conversation privacy: defaults', () => {
  it('1. a new conversation with no grant is private', () => {
    expect(evaluate({ grant: null })).toMatchObject({ allow: false, reason: 'no_grant' });
  });

  it('2/3. existing unclassified history can never reach a cloud provider', () => {
    const legacy = turn({ privacyClass: null, regime: 'PRIVATE', createdAt: T(-5) });
    expect(evaluate({ turns: [legacy] })).toMatchObject({ allow: false, reason: 'unclassified_history' });
    // A ceiling of PUBLIC is no loophole either: the null class is refused, not skipped.
    expect(evaluate({ grant: grant({ ceiling: 'PUBLIC' }), turns: [legacy] }))
      .toMatchObject({ allow: false, reason: 'unclassified_history' });
  });

  it('records unknown classifications as RESTRICTED rather than assuming they are benign', () => {
    expect(classificationForTurn(undefined)).toBe('RESTRICTED');
    expect(classificationForTurn('NOT_A_CLASS')).toBe('RESTRICTED');
    expect(classificationForTurn('INTERNAL')).toBe('INTERNAL');
  });

  it('a turn produced without a grant is not marked cloud-permitted', () => {
    expect(regimeForGrant({ allow: false, reason: 'no_grant', detail: 'x' })).toBe('PRIVATE');
    expect(regimeForGrant(undefined)).toBe('PRIVATE');
  });
});

describe('conversation privacy: grants', () => {
  it('4. an authorised conversation with eligible history is allowed for the named provider', () => {
    const decision = evaluate({ turns: [turn(), turn({ createdAt: T(-9) })], requestedProvider: 'openrouter' });
    expect(decision).toMatchObject({ allow: true, provider: 'openrouter', ceiling: 'INTERNAL' });
    expect(decision.allow && decision.contextTurns).toHaveLength(2);
  });

  it('5/6. SENSITIVE and RESTRICTED history cannot be granted to cloud', () => {
    expect(evaluate({ turns: [turn({ privacyClass: 'SENSITIVE' })] }))
      .toMatchObject({ allow: false, reason: 'ceiling_exceeded' });
    expect(evaluate({ turns: [turn({ privacyClass: 'RESTRICTED' })] }))
      .toMatchObject({ allow: false, reason: 'ceiling_exceeded' });
  });

  it('a grant cannot declare a ceiling above what cloud routing permits', () => {
    expect(evaluate({ grant: grant({ ceiling: 'SENSITIVE' }), turns: [] }))
      .toMatchObject({ allow: false, reason: 'ceiling_above_cloud' });
  });

  it('7. an unreadable expiry fails closed rather than granting', () => {
    expect(evaluate({ grant: grant({ expiresAt: 'not-a-date' }) })).toMatchObject({ allow: false, reason: 'expired' });
  });

  it('8. provider substitution is refused', () => {
    expect(evaluate({ requestedProvider: 'anthropic' })).toMatchObject({ allow: false, reason: 'provider_mismatch' });
  });

  it('9. a grant cannot be used by another principal', () => {
    expect(evaluate({ grant: grant({ principalId: 'someone-else' }) }))
      .toMatchObject({ allow: false, reason: 'cross_principal' });
    expect(evaluate({ turns: [turn({ principalId: 'someone-else' })] }))
      .toMatchObject({ allow: false, reason: 'cross_principal' });
  });

  it('10. a revoked grant is refused, including immediately after revocation', () => {
    expect(evaluate({ grant: grant({ revokedAt: T(-1) }) })).toMatchObject({ allow: false, reason: 'revoked' });
  });

  it('11. an expired grant is refused', () => {
    expect(evaluate({ grant: grant({ expiresAt: T(-1) }) })).toMatchObject({ allow: false, reason: 'expired' });
    expect(evaluate({ grant: grant({ expiresAt: T(10) }) })).toMatchObject({ allow: true });
  });

  it('20. an unknown policy version fails closed', () => {
    expect(evaluate({ grant: grant({ policyVersion: CONVERSATION_POLICY_VERSION + 1 }) }))
      .toMatchObject({ allow: false, reason: 'policy_version_mismatch' });
  });

  it('a malformed grant is refused', () => {
    expect(evaluate({ grant: grant({ provider: '' }) })).toMatchObject({ allow: false, reason: 'malformed_grant' });
    expect(evaluate({ grant: grant({ createdAt: 'yesterday' }) })).toMatchObject({ allow: false, reason: 'malformed_grant' });
  });

  it('a grant for another conversation is refused', () => {
    expect(evaluate({ grant: grant({ conversationId: 'conv-2' }) }))
      .toMatchObject({ allow: false, reason: 'conversation_mismatch' });
  });

  it('15. a conversation identifier alone cannot bypass the policy', () => {
    expect(evaluate({ conversationId: 'conv-9', turns: [] })).toMatchObject({ allow: false, reason: 'conversation_mismatch' });
  });

  it('a grant that does not authorise conversation inference is refused', () => {
    expect(evaluate({ grant: grant({ purpose: 'tool_execution' as never }) }))
      .toMatchObject({ allow: false, reason: 'purpose_not_permitted' });
  });
});

describe('conversation privacy: history boundaries', () => {
  it('25. private history written before the grant is never released by changing a preference', () => {
    const before = turn({ createdAt: T(-60), privacyClass: 'PRIVATE' as never, regime: 'PRIVATE' });
    const decision = evaluate({ turns: [before, turn()] });
    expect(decision.allow).toBe(true);
    expect(decision.allow && decision.contextTurns.map(entry => entry.createdAt)).toEqual([T(-10)]);
  });

  it('a turn produced under the private regime after a grant still blocks dispatch', () => {
    expect(evaluate({ turns: [turn({ regime: 'PRIVATE' })] }))
      .toMatchObject({ allow: false, reason: 'unclassified_history' });
  });

  it('13. history from another conversation is refused outright', () => {
    expect(evaluate({ turns: [turn({ conversationId: 'conv-2' })] }))
      .toMatchObject({ allow: false, reason: 'conversation_mismatch' });
  });

  it('a fresh conversation can be authorised with empty history', () => {
    expect(evaluate({ turns: [] })).toMatchObject({ allow: true });
  });

  it('the grant ceiling is what the caller must compile context against', () => {
    const decision = evaluate({ grant: grant({ ceiling: 'PUBLIC' }), turns: [turn({ privacyClass: 'INTERNAL' })] });
    expect(decision).toMatchObject({ allow: false, reason: 'ceiling_exceeded' });
  });
});
