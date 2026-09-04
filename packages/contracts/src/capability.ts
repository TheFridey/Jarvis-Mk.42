/**
 * Capability — a declared, versioned contract for a class of effects.
 *
 * Governance: docs/architecture/AGENCY_MODEL.md, ADR-0016
 *
 * A capability is DATA (a manifest) + an out-of-process adapter. Registering
 * one touches only the Capability Registry — the Kernel binary does not change
 * (L28, L29). Every invocation runs through the single Executor pipeline:
 * validate -> policy -> permission -> freshness barrier -> (simulate) ->
 * execute -> verify -> emit -> (rollback/compensate).
 */

import type { CorrelationId, Timestamp, Ulid } from './common.ts';
import type { PrivacyClass } from './event.ts';

export type RiskClass = 'AMBIENT' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type NodeTrustTier =
  | 'kernel-local'
  | 'owned-secure'
  | 'owned-mobile'
  | 'guest';

/** A named entry point on the adapter (execute / verify / simulate / rollback). */
export type ActionRef = string;

export type VerificationStrategy =
  | { kind: 'world-read'; adapterRef: ActionRef }
  | { kind: 'event-await'; eventType: string; matchPath: string; timeoutMs: number }
  | { kind: 'hash-match'; ofPath: string; expectPath: string }
  | { kind: 'health-probe'; adapterRef: ActionRef }
  | { kind: 'state-echo'; adapterRef: ActionRef };

export type RollbackStrategy =
  | { kind: 'inverse-action'; adapterRef: ActionRef }
  | { kind: 'restore-snapshot'; capturedBy: ActionRef; restoreRef: ActionRef }
  | { kind: 'saga-compensate' };

export interface CapabilityStep {
  ordinal: number;
  name: string;
  verify: ActionRef;
  /** Saga compensation, run in reverse order on crash mid-action. */
  compensate: ActionRef;
  idempotent: boolean;
}

export interface CapabilityAction {
  name: string;
  /** JSON Schema documents. */
  inputSchema: unknown;
  outputSchema: unknown;

  riskClass: RiskClass;

  reversible: boolean;
  /** Required when reversible && side-effecting. */
  rollback?: ActionRef;

  simulate?: ActionRef;
  /** If false, the Executor escalates approval instead of pretending. */
  simulatable: boolean;

  /** MANDATORY. Confirms the effect against the world (L22). */
  verify: ActionRef;

  /** Per invocationId. If false, the Executor never auto-retries. */
  idempotent: boolean;

  /** Present for multi-step actions. */
  steps?: CapabilityStep[];

  /** Human-readable declaration, consumed by policy and audit. */
  sideEffects: string[];
  approvalPolicy: 'default' | 'always' | 'hard_confirmation' | `preauthorized:${string}`;
  timeoutMs: number;
  verificationStrategy: VerificationStrategy;
  rollbackStrategy?: RollbackStrategy;
  idempotencyKeySelector?: string;
  confirmationPhrase?: string;
  declaredEgress?: string[];
}

export interface Capability {
  id: string; // e.g. "capabilities.filesystem"
  version: string; // semver
  description: string;
  provider: string;
  credentialKind?: 'none' | 'derived' | 'wrapped-static';
  executionEnvironment: 'worker' | 'worker+container' | `node-local:${string}`;
  auditPolicy: { hashInput: boolean; recordOutput: 'none' | 'summary' | 'full' };
  privacyRequirements: { maxContentPrivacyClass: PrivacyClass };
  actions: CapabilityAction[];

  /** Scope names a grant must include for any action here to be authorised. */
  requiredScopes: string[];

  /** Lowest node trust tier permitted to HOST the adapter. */
  trustTierMin: NodeTrustTier;

  /**
   * Optional: derives a mutual-exclusion key from the action input, so the
   * Executor can lease a contended resource (STATE_MODEL.md §5).
   * Expressed as a JSONPath-like selector string in the manifest.
   */
  resourceKeySelector?: string;
}

/** One concrete run through the Executor. */
export interface CapabilityInvocation {
  invocationId: Ulid;
  capabilityId: string;
  capabilityVersion: string;
  action: string;
  input: unknown;
  correlationId: CorrelationId;
  requestedAt: Timestamp;
}

export type InvocationOutcome =
  | 'rejected'
  | 'denied'
  | 'aborted'
  | 'verified'
  | 'rolled_back'
  | 'verification_failed'
  | 'compensated'
  | 'partially_completed'
  | 'failed'
  | 'simulated'
  | 'awaiting_approval';

export interface InvocationResult {
  invocationId: Ulid;
  outcome: InvocationOutcome;
  output?: unknown;
  verifyReport?: unknown;
  finishedAt: Timestamp;
}
