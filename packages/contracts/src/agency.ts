import type { CorrelationId, PrincipalId, Timestamp, Ulid } from './common.ts';
import type { EventActor } from './event.ts';
import type { RiskClass } from './capability.ts';

export type InvocationState =
  | 'PROPOSED' | 'VALIDATED' | 'POLICY_CHECKED'
  | 'AWAITING_APPROVAL' | 'APPROVED' | 'SIMULATING' | 'SIMULATED'
  | 'EXECUTING' | 'VERIFYING' | 'COMPLETED'
  | 'REJECTED' | 'DENIED' | 'ABORTED' | 'FAILED' | 'VERIFICATION_FAILED'
  | 'ROLLING_BACK' | 'ROLLED_BACK' | 'COMPENSATING' | 'PARTIALLY_COMPLETED';

export const TERMINAL_INVOCATION_STATES = [
  'REJECTED', 'DENIED', 'ABORTED', 'FAILED', 'VERIFICATION_FAILED',
  'ROLLED_BACK', 'PARTIALLY_COMPLETED', 'COMPLETED',
] as const satisfies readonly InvocationState[];

export const LEGAL_INVOCATION_TRANSITIONS: Record<InvocationState, InvocationState[]> = {
  PROPOSED: ['VALIDATED', 'REJECTED'],
  VALIDATED: ['POLICY_CHECKED', 'REJECTED'],
  POLICY_CHECKED: ['AWAITING_APPROVAL', 'APPROVED', 'DENIED'],
  AWAITING_APPROVAL: ['APPROVED', 'DENIED'],
  APPROVED: ['SIMULATING', 'EXECUTING', 'ABORTED'],
  SIMULATING: ['SIMULATED', 'FAILED', 'ABORTED'],
  SIMULATED: ['EXECUTING', 'ABORTED', 'DENIED'],
  EXECUTING: ['VERIFYING', 'FAILED', 'COMPENSATING'],
  VERIFYING: ['COMPLETED', 'VERIFICATION_FAILED', 'ROLLING_BACK'],
  ROLLING_BACK: ['ROLLED_BACK', 'VERIFICATION_FAILED'],
  COMPENSATING: ['PARTIALLY_COMPLETED'],
  COMPLETED: [], REJECTED: [], DENIED: [], ABORTED: [], FAILED: [],
  VERIFICATION_FAILED: [], ROLLED_BACK: [], PARTIALLY_COMPLETED: [],
};

export interface InvocationLifecycle {
  invocationId: Ulid;
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
  kind: 'derived' | 'wrapped-static';
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
