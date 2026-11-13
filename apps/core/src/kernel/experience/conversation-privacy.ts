import type { PrivacyClass } from '@jarvis/contracts';

/**
 * Conversation privacy policy.
 *
 * The rule this module exists to enforce: **a grant is not a key to history**. It
 * authorises one conversation to send *newly produced*, suitably classified content to
 * one named provider. Anything older than the grant, anything unclassified, and anything
 * above the ceiling stays local and the request is refused rather than quietly trimmed.
 *
 * Pure functions only — no SQL, no clock, no network — so every refusal can be tested.
 */

/** Bump when the rules change; old grants then fail closed instead of being reinterpreted. */
export const CONVERSATION_POLICY_VERSION = 1;

export type ConversationRegime = 'PRIVATE' | 'CLOUD_PERMITTED';

/** The highest class a cloud provider may ever see, regardless of what a grant says. */
export const CLOUD_CEILING: PrivacyClass = 'INTERNAL';

const RANK: Record<PrivacyClass, number> = { PUBLIC: 0, INTERNAL: 1, SENSITIVE: 2, RESTRICTED: 3 };
const rank = (value: string | null | undefined): number =>
  value && Object.hasOwn(RANK, value) ? RANK[value as PrivacyClass] : Number.POSITIVE_INFINITY;

export interface ConversationGrant {
  grantId: string;
  conversationId: string;
  principalId: string;
  provider: string;
  model: string;
  purpose: 'conversation';
  ceiling: PrivacyClass;
  policyVersion: number;
  createdAt: string;
  expiresAt?: string | null;
  revokedAt?: string | null;
}

export interface ConversationTurn {
  conversationId: string;
  principalId: string;
  createdAt: string;
  /** Absent or null means "written before classifications existed" — never eligible. */
  privacyClass?: PrivacyClass | null;
  regime: ConversationRegime;
}

export type GrantRefusal =
  | 'no_grant'
  | 'unknown_conversation'
  | 'conversation_mismatch'
  | 'cross_principal'
  | 'revoked'
  | 'expired'
  | 'policy_version_mismatch'
  | 'provider_mismatch'
  | 'purpose_not_permitted'
  | 'ceiling_above_cloud'
  | 'unclassified_history'
  | 'ceiling_exceeded'
  | 'malformed_grant';

export type GrantDecision =
  | { allow: true; grantId: string; provider: string; model: string; ceiling: PrivacyClass; contextTurns: ConversationTurn[] }
  | { allow: false; reason: GrantRefusal; detail: string };

const deny = (reason: GrantRefusal, detail: string): GrantDecision => ({ allow: false, reason, detail });

const instant = (value: string | null | undefined): number | undefined => {
  if (!value) return undefined;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : undefined;
};

/**
 * Decide whether this conversation may dispatch to a provider right now, and exactly
 * which turns may accompany it.
 *
 * Refusals are total: there is no partial authorisation and no "best effort" context.
 */
export function evaluateConversationGrant(input: {
  conversationId: string | undefined;
  principalId: string | undefined;
  grant?: ConversationGrant | null;
  turns: readonly ConversationTurn[];
  /** The provider a caller is asking for, if any. It must match the grant. */
  requestedProvider?: string;
  now?: number;
}): GrantDecision {
  const { conversationId, principalId, turns } = input;
  if (!conversationId || !principalId) return deny('unknown_conversation', 'No conversation or principal was supplied.');

  // Ownership is checked before anything else: a turn from another principal or another
  // conversation means the caller is confusing two histories, and we fail closed.
  for (const turn of turns) {
    if (turn.conversationId !== conversationId) return deny('conversation_mismatch', 'History contains turns from another conversation.');
    if (turn.principalId !== principalId) return deny('cross_principal', 'History contains turns owned by another principal.');
  }

  const grant = input.grant;
  if (!grant) return deny('no_grant', 'This conversation is private. No cloud grant exists.');
  if (!grant.grantId || !grant.provider || !grant.model) return deny('malformed_grant', 'The grant is missing its identifier, provider or model.');
  if (grant.conversationId !== conversationId) return deny('conversation_mismatch', 'The grant belongs to another conversation.');
  if (grant.principalId !== principalId) return deny('cross_principal', 'The grant belongs to another principal.');
  if (grant.revokedAt) return deny('revoked', 'The grant has been revoked.');
  if (grant.purpose !== 'conversation') return deny('purpose_not_permitted', 'This grant does not authorise conversation inference.');
  if (grant.policyVersion !== CONVERSATION_POLICY_VERSION) {
    return deny('policy_version_mismatch', 'The grant was issued under a different privacy policy version.');
  }

  const now = input.now ?? Date.now();
  if (grant.expiresAt !== undefined && grant.expiresAt !== null) {
    const expires = instant(grant.expiresAt);
    if (expires === undefined) return deny('expired', 'The grant expiry cannot be read, so the grant is treated as expired.');
    if (expires <= now) return deny('expired', 'The grant has expired.');
  }

  if (input.requestedProvider && input.requestedProvider !== grant.provider) {
    return deny('provider_mismatch', `This conversation is authorised for ${grant.provider}, not ${input.requestedProvider}.`);
  }

  // A grant can never raise what cloud routing allows: above INTERNAL the existing
  // ceiling forces local inference, so such a grant is simply refused.
  if (rank(grant.ceiling) > rank(CLOUD_CEILING)) {
    return deny('ceiling_above_cloud', `A ceiling of ${grant.ceiling} cannot be used for cloud inference.`);
  }

  const grantedAt = instant(grant.createdAt);
  if (grantedAt === undefined) return deny('malformed_grant', 'The grant creation time cannot be read.');

  // Only turns produced *under* this grant are eligible. Older turns were private when
  // they were written; a later authorisation must not retroactively release them.
  const eligible = turns.filter(turn => (instant(turn.createdAt) ?? Number.POSITIVE_INFINITY) >= grantedAt);

  for (const turn of eligible) {
    if (turn.privacyClass === undefined || turn.privacyClass === null) {
      return deny('unclassified_history', 'A turn in this conversation has no privacy classification.');
    }
    if (rank(turn.privacyClass) > rank(grant.ceiling)) {
      return deny('ceiling_exceeded', `A turn classified ${turn.privacyClass} exceeds this grant's ${grant.ceiling} ceiling.`);
    }
    if (turn.regime !== 'CLOUD_PERMITTED') {
      return deny('unclassified_history', 'A turn was produced under the private regime and cannot be sent.');
    }
  }

  return {
    allow: true,
    grantId: grant.grantId,
    provider: grant.provider,
    model: grant.model,
    ceiling: grant.ceiling,
    contextTurns: eligible,
  };
}

/** True when this class may ever be sent to a provider. */
export function isCloudCeiling(ceiling: PrivacyClass | string | null | undefined): boolean {
  return rank(ceiling) <= rank(CLOUD_CEILING);
}

/** What a turn should record about the regime it was produced under. */
export function regimeForGrant(decision: GrantDecision | undefined): ConversationRegime {
  return decision?.allow ? 'CLOUD_PERMITTED' : 'PRIVATE';
}

/**
 * The classification a turn inherits. Unknown input is never assumed benign: a missing
 * or unrecognised class is recorded as RESTRICTED, which keeps it local forever.
 */
export function classificationForTurn(privacyClass: PrivacyClass | string | undefined | null): PrivacyClass {
  if (privacyClass && Object.hasOwn(RANK, privacyClass)) return privacyClass as PrivacyClass;
  return 'RESTRICTED';
}
