import type { CorrelationId, PrincipalId, Timestamp } from './common.ts';
import type { AgentResult } from './agent-result.ts';
import type { ModelTask, Locality } from './model.ts';
export const AgentIds = ['agents.nova','agents.argus','agents.atlas','agents.daedalus','agents.forge','agents.hephaestus','agents.hermes','agents.mnemosyne','agents.oracle','agents.prometheus','agents.scout','agents.sentinel'] as const;
export type AgentId = typeof AgentIds[number];
export class AgentJobAccessError extends Error {
  readonly code = 'AGENT_JOB_NOT_FOUND_FOR_PRINCIPAL';
  constructor() { super('agent job not found for principal'); this.name='AgentJobAccessError'; }
}
export interface AgentManifest { id: string; version: string; displayName: string; role: string; leasePolicy: { maxWallTimeMs: number; maxContextUnits: number; maxCostUnits: number }; proposalScope: { kinds: string[]; capabilities: string[] }; modelHints: { tasks: ModelTask[]; locality: Locality }; notes?: string; }
export interface CognitionRequest { requestId: string; principalId: PrincipalId; correlationId: CorrelationId; input: string; agentId: AgentId; task: ModelTask; locality?: Locality; maxCost?: number; maxLatencyMs?: number; realtime?: boolean; cloudAllowed?: boolean; preferredModels?: string[]; preferredProviders?: string[]; objectiveId?:string; workflowRef?:string; parentJobId?:string; perceptionRef?:string;analysisOnly?:boolean;
  /** Current operator turn, supplied by Kernel conversation assembly. History in input is context, not routing intent. */
  currentTurnInput?:string;
  /** Kernel-held verified capability output (untrusted content) injected as required context. */
  evidenceRef?:string;
  contextScope?:'public-web'|'conversation'; }
export interface CognitionResponse { requestId: string; principalId: PrincipalId; correlationId: CorrelationId; result: AgentResult; modelId: string; answer?: string; createdAt: Timestamp; conversationId?:string; }
