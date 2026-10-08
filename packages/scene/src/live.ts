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
  ModelRoutingObservability,
  ModelResponse,
  AgentId,
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
  scalesmiths?: import('@jarvis/contracts').ScaleSmithsOperatingPicture;
  referentFocus?:{objectId:string;confidence:number;observedAt:string;expiresAt:string;bounds?:{x:number;y:number;width:number;height:number};monitorId?:string};
  voiceAudio?: import('@jarvis/contracts').VoiceAudioState;
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
  modelUsage?: { generatedAt: string; models: ModelUsageSummary[] };
  activeAgents: OperatingAgentRun[];
  agentJobs?: OperatingAgentJob[];
  cognitionResponseBodiesTruncated?: boolean;
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

export interface OperatingAgentJob {
  jobId: string; agentId: string; correlationId: string; objectiveId?: string; parentJobId?: string;
  taskClass: string; state: 'QUEUED'|'LEASED'|'RUNNING'|'WAITING'|'COMPLETE'|'BLOCKED'|'FAILED'|'CANCELLED';
  attempt: number; startedAt?: string; finishedAt?: string; lastHeartbeat?: string; deadline: string;
  budget: { wallMs: number; contextUnits: number; costLimit: number };
  selectedModelId?: string; proposalCount: number; proposedCapabilities: string[]; evidenceRefs: string[]; errorCode?: string;
  /** Gateway routing-policy rejections for a failed job that never selected a model. */
  routeRejections?: string[];
  activityStage?: OperatingAgentJob['state'] | 'WAITING_APPROVAL' | 'VERIFYING';
  activityConfirmed?: boolean;
  evidenceCount?: number; evidenceRefsTruncated?: boolean;
  capabilityActivity?: Array<{ invocationId:string; capabilityId:string; state:InvocationState }>;
}
/** Presentation membership only: never credentials, policy, or execution authority. */
export const AGENT_ORCHESTRATION_GROUPS = {
  NOVA: ['agents.nova','agents.hermes','agents.scout','agents.prometheus','agents.atlas','agents.mnemosyne'],
  ENGINEERING: ['agents.forge','agents.hephaestus','agents.daedalus'],
  SENTINEL: ['agents.sentinel','agents.argus'],
  KNOWLEDGE: ['agents.atlas','agents.mnemosyne'],
  RESEARCH: ['agents.scout','agents.oracle'],
} as const;

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
export interface OperatingModelRun { requestId: string; correlationId:string; modelId: string | null; agentId: string; taskClass?:string; privacyClass?:string; objectiveRef?:string; workflowRef?:string; activityConfirmed?:boolean; status: 'running' | 'completed' | 'failed'; startedAt: string; firstTokenAt?:string; finishedAt?: string; latencyMs?: number; contextUnits?: number; outputUnits?: number; costEstimate?: number; usage?:ModelResponse['usage']; routing?:ModelRoutingObservability; errorClass?:string; }
export interface OperatingAgentRun { agentId: string; requestId: string; status: 'running'; startedAt: string; }
export interface OperatingTelemetrySummary { availability: 'available' | 'partial' | 'unavailable'; generatedAt: string; eventRatePerMinute?: number; traceExport: 'active' | 'inactive' | 'unknown'; system?: SystemTelemetrySnapshot; }
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
  | { type:'experience.notification';schemaVersion:1;id:string;title:string;body:string;severity:string }
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
export interface DesktopCognitionCommand { commandId: string; expectedStateVersion: number; input: string; preferredModels?:string[]; conversationId?:string; agentId?: AgentId; task?: 'reason'|'plan'|'summarize'|'extract'|'classify'|'code'; locality?: 'local'|'prefer-local'|'any'|'cloud-ok'; }
export interface DesktopAgentCancelCommand { commandId: string; expectedStateVersion: number; jobId: string; }
export interface DesktopAgentCancelResponse { jobId: string; cancelled: boolean; }

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

export interface TelemetryReading { value: number | null; unit: string; status: 'available' | 'unavailable' | 'stale'; observedAt: string | null; }
export interface SystemTelemetrySnapshot {
  generatedAt: string; window: '24h'; overallHealth: 'healthy' | 'degraded' | 'unknown';
  readings: Record<string, TelemetryReading>;
  history: Array<{ at: string; values: Record<string, number | null> }>;
}

export type UsagePeriod = '24h' | 'week' | 'month' | 'all';
export interface ModelUsageSummary {
  modelId: string; period: UsagePeriod; requests: number; measuredCostRequests: number;
  actualCost: number | null; estimatedCost: number | null; inputTokens: number | null; outputTokens: number | null;
}
