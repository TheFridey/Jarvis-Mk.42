/**
 * Permission — grants, scopes, and TTL'd authority tokens (L18, L19).
 *
 * Governance: docs/architecture/SECURITY_MODEL.md §3, §7
 *
 * The Permission Engine owns grants and mints authority tokens. The Executor
 * checks the token AND re-reads the grant version at a freshness barrier inside
 * the `capability.started` transaction (STATE_MODEL.md §5) so a just-revoked
 * grant cannot be used.
 */

import type { PrincipalId, Timestamp, Ulid } from './common.ts';
import type { RiskClass } from './capability.ts';

/** Authorisation strength required for a risk class (SECURITY_MODEL.md §3). */
export type AuthorityTier =
  | 'AMBIENT' // standing ambient grant, no prompt
  | 'STANDARD' // standing scoped grant
  | 'ELEVATED' // standing scoped grant + post-hoc notification
  | 'CONFIRMED' // live approval OR explicit standing "may proceed" scope
  | 'DUAL'; // two deliberate authorisations + always simulate-first

export const RISK_TO_AUTHORITY: Record<RiskClass, AuthorityTier> = {
  AMBIENT: 'AMBIENT',
  LOW: 'STANDARD',
  MEDIUM: 'ELEVATED',
  HIGH: 'CONFIRMED',
  CRITICAL: 'DUAL',
} as const;

export interface Grant {
  id: Ulid;
  principalId: PrincipalId;
  /** Who may exercise it: the principal, or agents acting for them. */
  holder: { kind: 'principal' | 'agent'; id: string };
  scopes: string[];
  /** Highest risk class this grant can satisfy without live approval. */
  maxRiskWithoutLiveApproval: RiskClass;
  /**
   * When true, CONFIRMED-tier actions in scope may proceed even if the operator
   * is unreachable (otherwise: fail closed). Off by default.
   */
  mayProceedWithoutLiveApproval: boolean;
  issuedAt: Timestamp;
  expiresAt?: Timestamp;
  /** Bumped on any change; the Executor's freshness barrier compares this. */
  version: number;
  revokedAt?: Timestamp;
}

/** Short-lived, scoped token minted per authorised invocation. */
export interface AuthorityToken {
  token: string;
  invocationId: Ulid;
  grantId: Ulid;
  grantVersion: number;
  scopes: string[];
  /** "dry-run" during simulation; "full" during execution. */
  mode: 'dry-run' | 'full';
  issuedAt: Timestamp;
  expiresAt: Timestamp;
}

export type ApprovalState = 'pending' | 'approved' | 'rejected' | 'expired';

export interface ApprovalRequest {
  id: Ulid;
  invocationId: Ulid;
  riskClass: RiskClass;
  summary: string;
  simulatedEffect?: unknown;
  state: ApprovalState;
  requestedAt: Timestamp;
  decidedAt?: Timestamp;
  /** For DUAL: both must be satisfied. */
  requiredAuthorisations: number;
  receivedAuthorisations: number;
}
