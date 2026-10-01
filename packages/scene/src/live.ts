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
  HealthReport,
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
  schemaVersion: 2;
  operatingPictureVersion: 1;
  generatedAt: string;
  stateVersion: number;
  sceneVersion: number;
  systemMode: SystemMode;
  interactionState: InteractionState;
  workState: WorkState;
  principal: { id: string | null; status: 'active' | 'unassigned' };
  presence: { status: 'present' | 'away' | 'unknown'; confidence?: number; observedAt?: string };
  activeObjective?: OperatingObjective;
  activeTasks: OperatingObjective[];
  activeModels: OperatingModelRun[];
  recentModelRuns: OperatingModelRun[];
  activeAgents: OperatingAgentRun[];
  activeCapabilities: DesktopCapabilityActivity[];
  systemHealth: HealthReport;
  telemetrySummary: OperatingTelemetrySummary;
  pendingApprovals: DesktopApproval[];
  conversationActivity: OperatingConversationActivity;
  selectedContext: { contextId: string | null; projectId: string | null };
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

export type JarvisOperatingPicture = DesktopKernelSnapshot;
/** Presentation axes derived from authoritative state. These are not Kernel modes. */
export type SystemMode = 'AMBIENT' | 'FOCUSED' | 'GUARDIAN' | 'DEGRADED';
export type InteractionState = 'DORMANT' | 'AWARE' | 'LISTENING' | 'INTERPRETING' | 'RESPONDING';
export type WorkState = 'IDLE' | 'THINKING' | 'ROUTING' | 'EXECUTING' | 'WAITING' | 'VERIFYING' | 'COMPLETE' | 'BLOCKED' | 'ERROR';
export interface AudioVisualEnvelope {
  schemaVersion: 1;
  source: 'microphone' | 'tts';
  sequence: number;
  observedAt: string;
  amplitude: number;
  low: number;
  mid: number;
  high: number;
}
export interface OperatingObjective { id: string; statement: string; status: string; priority: number; updatedAt: string; }
export interface OperatingModelRun { requestId: string; modelId: string | null; agentId: string; status: 'running' | 'completed' | 'failed'; startedAt: string; finishedAt?: string; latencyMs?: number; contextUnits?: number; outputUnits?: number; costEstimate?: number; }
export interface OperatingAgentRun { agentId: string; requestId: string; status: 'running'; startedAt: string; }
export interface OperatingTelemetrySummary { availability: 'available' | 'partial' | 'unavailable'; generatedAt: string; eventRatePerMinute?: number; traceExport: 'active' | 'inactive' | 'unknown'; }
export interface OperatingConversationActivity { activeSessionIds: string[]; activeRunIds: string[]; recentResponseIds: string[]; }

export type ExperienceChannel = 'system' | 'objectives' | 'cognition' | 'agency' | 'notifications' | 'scene' | 'telemetry';
export interface ExperienceStreamUpdate {
  type: 'experience.update'; schemaVersion: 1; streamId: string; sequence: number;
  generatedAt: string; stateVersion: number; sceneVersion: number;
  channels: ExperienceChannel[]; full: boolean;
  patch: Partial<JarvisOperatingPicture>;
}
export type ExperienceClientMessage =
  | { type: 'experience.subscribe'; schemaVersion: 1; accessToken: string; nodeId: string; sessionId: string; channels: ExperienceChannel[]; resume?: { streamId: string; sequence: number } }
  | { type: 'experience.pong'; schemaVersion: 1; at: string };
export type ExperienceServerMessage = ExperienceStreamUpdate
  | { type: 'experience.ready'; schemaVersion: 1; streamId: string; sequence: number; heartbeatMs: number }
  | { type: 'experience.heartbeat'; schemaVersion: 1; at: string; sequence: number }
  | { type: 'experience.resync_required'; schemaVersion: 1; streamId: string; reason: string }
  | { type: 'experience.error'; schemaVersion: 1; code: string; detail: string };

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
