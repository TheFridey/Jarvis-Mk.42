/**
 * Identity Manager contracts.
 *
 * Governance: docs/architecture/KERNEL_CONSTITUTION.md sec 1 (#1),
 *             docs/architecture/SECURITY_MODEL.md sec 5.
 *
 * Multi-user from the schema down (L34): a Principal is never assumed unique.
 * MK.43 runs one principal; the abstraction is complete.
 */

import type { PrincipalId, Timestamp, Ulid } from './common.ts';

export type IdentityKind =
  | 'principal' // a human (later: autonomous) identity JARVIS acts for
  | 'device' // a physical device bound to a principal
  | 'node' // a compute node in the Node Protocol
  | 'service'; // an internal service/process identity

/** How confident the Identity Manager is in an authentication. */
export type TrustLevel =
  | 'untrusted' // unauthenticated / failed
  | 'provisional' // authenticated by a weak or single factor
  | 'trusted' // authenticated, normal
  | 'verified'; // authenticated by a strong/multi factor

export type AuthMethod =
  | 'bootstrap' // local operator bootstrap credential (MK.43)
  | 'token' // bearer/session token
  | 'mtls' // mutual TLS (node identities)
  | 'voice' // FUTURE INTERFACE - voice identity (not implemented in MK.43)
  | 'biometric'; // FUTURE INTERFACE - biometric assertion (not implemented in MK.43)

export interface Principal {
  id: PrincipalId;
  displayName: string;
  /** Operator flag - administrative authority (SECURITY_MODEL.md sec 7). */
  isOperator: boolean;
  createdAt: Timestamp;
  disabledAt?: Timestamp;
}

export interface Identity {
  id: Ulid;
  kind: IdentityKind;
  /** The principal this identity belongs to / acts for. */
  principalId: PrincipalId;
  /** Stable external reference: device fingerprint, node id, service name. */
  externalRef: string;
  displayName: string;
  trust: TrustLevel;
  createdAt: Timestamp;
  revokedAt?: Timestamp;
}

/**
 * The authentication context attached to an inbound request/command once the
 * Identity Manager has resolved it. Everything downstream reads this, never
 * raw credentials.
 */
export interface AuthContext {
  identityId: Ulid;
  principalId: PrincipalId;
  kind: IdentityKind;
  method: AuthMethod;
  trust: TrustLevel;
  /** Node the request arrived on / from. */
  nodeId: string;
  authenticatedAt: Timestamp;
  /** Null-ish for non-expiring bootstrap contexts; set for tokens. */
  expiresAt?: Timestamp;
  /** Session and node bindings are mandatory for access credentials. */
  sessionId?: Ulid;
  scopes?: string[];
  authStrength?: 'bootstrap' | 'single_factor' | 'strong';
  credentialId?: Ulid;
  issuedAt?: Timestamp;
}

export interface SessionAccessCredential {
  id: Ulid;
  identityId: Ulid;
  principalId: PrincipalId;
  sessionId: Ulid;
  nodeId: string;
  scopes: string[];
  authStrength: 'bootstrap' | 'single_factor' | 'strong';
  issuedAt: Timestamp;
  expiresAt: Timestamp;
  generation: number;
  revokedAt?: Timestamp;
}

export interface AuthenticateRequest {
  method: AuthMethod;
  /** Method-specific material. Never logged, never stored raw. */
  credential: string;
  nodeId: string;
  claimedPrincipalId?: PrincipalId;
}

export type AuthenticateResult =
  | { ok: true; context: AuthContext }
  | { ok: false; code: AuthFailureCode; detail: string };

export type AuthFailureCode =
  | 'unknown_identity'
  | 'bad_credential'
  | 'revoked'
  | 'disabled_principal'
  | 'method_unsupported'
  | 'expired';

/** FUTURE INTERFACE - not implemented in MK.43. Shape reserved. */
export interface AssertionInput {
  kind: 'voice' | 'biometric';
  principalIdHint?: PrincipalId;
  /** Opaque assertion payload produced by a perception subsystem. */
  assertion: unknown;
  observedAt: Timestamp;
}
