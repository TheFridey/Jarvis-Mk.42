import type {
  ApprovalRequest,
  CapabilityInvocationProposal,
  DiagnosticsReport,
  InvocationOutcome,
  InvocationState,
  RiskClass,
  CognitionResponse,
  Session,
  SystemStateView,
} from '@jarvis/contracts';
import type { SemanticScene } from './types.ts';

export interface DesktopCapabilityActivity {
  invocationId: string;
  capabilityId: string;
  action: string;
  actor: string;
  risk: RiskClass;
  state: InvocationState;
  updatedAt: string;
  finalOutcome?: string;
}

export interface DesktopPolicyDenial {
  invocationId: string;
  capabilityId: string;
  action: string;
  reason: string;
  at: string;
}

export interface DesktopApproval extends ApprovalRequest {
  actor: string;
  resource: string;
  reason: string;
  scopes: string[];
  arguments: Record<string, unknown>;
}

export interface DesktopKernelSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  stateVersion: number;
  principalId: string | null;
  diagnostics: DiagnosticsReport;
  state: SystemStateView;
  sessions: Session[];
  notifications: string[];
  objectives: string[];
  cognitionResponses: CognitionResponse[];
  capabilityActivity: DesktopCapabilityActivity[];
  policyDenials: DesktopPolicyDenial[];
  approvals: DesktopApproval[];
  scene: SemanticScene;
  selectedProjectId: string | null;
  contextId: string | null;
}

export interface DesktopProposalCommand {
  commandId: string;
  expectedStateVersion: number;
  proposal: CapabilityInvocationProposal;
}

export interface DesktopProposalResponse {
  commandId: string;
  stateVersion: number;
  result: { invocationId: string; outcome: InvocationOutcome; output?: unknown; verifyReport?: unknown; finishedAt: string };
}
export interface DesktopCognitionCommand { commandId: string; expectedStateVersion: number; input: string; agentId?: 'agents.oracle'|'agents.scout'|'agents.forge'; task?: 'reason'|'plan'|'summarize'|'extract'|'classify'|'code'; locality?: 'local'|'prefer-local'|'any'|'cloud-ok'; }

export interface DesktopApprovalCommand {
  commandId: string;
  expectedStateVersion: number;
  approvalId: string;
  invocationId: string;
  nonce: string;
  version: number;
  decision: 'approve' | 'deny';
  confirmationPhrase?: string;
}

export interface DesktopCommandConflict {
  error: 'state_version_conflict';
  currentStateVersion: number;
}
