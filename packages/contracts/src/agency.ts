import type { CorrelationId, PrincipalId, Timestamp, Ulid } from './common.ts';
import type { EventActor } from './event.ts';
import type { RiskClass } from './capability.ts';

export type InvocationState =
  | 'PROPOSED' | 'VALIDATED' | 'POLICY_CHECKED'
  | 'AWAITING_APPROVAL' | 'APPROVED' | 'SIMULATING' | 'SIMULATED'
  | 'LEASE_ACQUIRED' | 'EXECUTING' | 'EXECUTED' | 'VERIFYING' | 'VERIFIED' | 'SUCCEEDED' | 'COMPLETED'
  | 'REJECTED' | 'DENIED' | 'ABORTED' | 'FAILED' | 'VERIFICATION_FAILED'
  | 'EXPIRED' | 'UNVERIFIED' | 'ROLLBACK_PENDING' | 'ROLLING_BACK' | 'ROLLED_BACK'
  | 'ROLLBACK_FAILED' | 'CANCELLED' | 'INTERRUPTED' | 'COMPENSATING' | 'PARTIALLY_COMPLETED';

export const TERMINAL_INVOCATION_STATES = [
  'REJECTED', 'DENIED', 'ABORTED', 'FAILED', 'VERIFICATION_FAILED',
  'ROLLED_BACK', 'ROLLBACK_FAILED', 'PARTIALLY_COMPLETED', 'SUCCEEDED', 'COMPLETED',
  'EXPIRED', 'UNVERIFIED', 'CANCELLED',
] as const satisfies readonly InvocationState[];

export const LEGAL_INVOCATION_TRANSITIONS: Record<InvocationState, InvocationState[]> = {
  PROPOSED: ['VALIDATED', 'REJECTED'],
  VALIDATED: ['POLICY_CHECKED', 'REJECTED', 'DENIED'],
  POLICY_CHECKED: ['AWAITING_APPROVAL', 'APPROVED', 'DENIED'],
  AWAITING_APPROVAL: ['APPROVED', 'DENIED'],
  APPROVED: ['SIMULATING', 'LEASE_ACQUIRED', 'EXECUTING', 'ABORTED', 'DENIED', 'CANCELLED'],
  LEASE_ACQUIRED: ['EXECUTING', 'INTERRUPTED', 'ABORTED', 'DENIED'],
  SIMULATING: ['SIMULATED', 'FAILED', 'ABORTED'],
  SIMULATED: ['LEASE_ACQUIRED', 'EXECUTING', 'ABORTED', 'DENIED'],
  EXECUTING: ['EXECUTED', 'VERIFYING', 'FAILED', 'INTERRUPTED', 'COMPENSATING', 'ROLLBACK_PENDING'],
  EXECUTED: ['VERIFYING', 'UNVERIFIED', 'ROLLBACK_PENDING', 'INTERRUPTED'],
  VERIFYING: ['VERIFIED', 'COMPLETED', 'UNVERIFIED', 'VERIFICATION_FAILED', 'ROLLBACK_PENDING', 'ROLLING_BACK', 'INTERRUPTED'],
  VERIFIED: ['SUCCEEDED', 'COMPLETED'],
  ROLLBACK_PENDING: ['ROLLING_BACK', 'ROLLBACK_FAILED'],
  ROLLING_BACK: ['ROLLED_BACK', 'ROLLBACK_FAILED', 'VERIFICATION_FAILED'],
  COMPENSATING: ['PARTIALLY_COMPLETED', 'ROLLBACK_PENDING'],
  INTERRUPTED: ['LEASE_ACQUIRED', 'ROLLBACK_PENDING', 'UNVERIFIED', 'CANCELLED'],
  COMPLETED: [], REJECTED: [], DENIED: [], ABORTED: [], FAILED: [],
  VERIFICATION_FAILED: [], ROLLED_BACK: [], ROLLBACK_FAILED: [], PARTIALLY_COMPLETED: [],
  EXPIRED: [], UNVERIFIED: [], CANCELLED: [], SUCCEEDED: [],
};

export interface InvocationLifecycle {
  invocationId: Ulid;
  proposalId?: string;
  capabilityId: string;
  capabilityVersion: string;
  action: string;
  state: InvocationState;
  correlationId: CorrelationId;
  principalId: PrincipalId;
  originActor: EventActor;
  riskClass: RiskClass;
  grantId?: Ulid;
  grantVersion?: number;
  approvalRequestId?: Ulid;
  resourceKey?: string;
  leaseId?: Ulid;
  inputHash: string;
  beforeStateRef?: string;
  predictedEffectRef?: string;
  verifyReportRef?: string;
  sessionId?: string;
  causationId?: string;
  traceId?: string;
  attemptCount?: number;
  finalOutcome?: string;
  proposal?: unknown;
  policyDecision?: unknown;
  permissionDecision?: unknown;
  credentialLeaseRef?: string;
  verificationMetadata?: unknown;
  rollbackMetadata?: unknown;
  recoveryState?: unknown;
  startedAt?: Timestamp;
  finishedAt?: Timestamp;
  history: Array<{ state: InvocationState; at: Timestamp; eventId: Ulid }>;
}

export interface CredentialHandle {
  handleId: string;
  invocationId: Ulid;
  scope: { capabilityId: string; action: string; resourceRef: string };
  mode: 'dry-run' | 'full';
  expiresAt: Timestamp;
  kind: 'none' | 'derived' | 'wrapped-static';
}

export interface AdapterContext {
  input: unknown;
  mode: 'dry-run' | 'full';
  credential: CredentialHandle;
  log: (level: 'debug' | 'info' | 'warn' | 'error', msg: string, fields?: Record<string, unknown>) => void;
  http: (req: { method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'; url: string }) => Promise<unknown>;
  abortSignal: AbortSignal;
}

export interface VerificationReport { verified: boolean; checks: Array<{ name: string; ok: boolean; detail: string }>; }
export interface RollbackReport { undone: boolean; residual: string[]; }
export interface PredictedEffect { summary: string; changes: Array<{ resource: string; from: unknown; to: unknown }>; }

export interface LabsRunReport {
  runId: Ulid;
  draftId: Ulid;
  build: { ok: boolean; log: string };
  tests: { passed: number; failed: number; report: string };
  staticAnalysis: { tscOk: boolean; lintOk: boolean; manifestOk: boolean; depAuditOk: boolean; egressOk: boolean; findings: string[] };
  verdict: 'passed' | 'failed';
  artifactHash: string;
  startedAt: Timestamp;
  finishedAt: Timestamp;
}
