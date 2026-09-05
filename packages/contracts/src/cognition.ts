import type { CorrelationId, PrincipalId, Timestamp } from './common.ts';
import type { AgentResult } from './agent-result.ts';
import type { ModelTask, Locality } from './model.ts';
export interface AgentManifest { id: string; version: string; displayName: string; role: string; leasePolicy: { maxWallTimeMs: number; maxContextUnits: number; maxCostUnits: number }; proposalScope: { kinds: string[]; capabilities: string[] }; modelHints: { tasks: ModelTask[]; locality: Locality }; notes?: string; }
export interface CognitionRequest { requestId: string; principalId: PrincipalId; correlationId: CorrelationId; input: string; agentId: 'agents.oracle' | 'agents.scout' | 'agents.forge'; task: ModelTask; locality?: Locality; maxCost?: number; maxLatencyMs?: number; }
export interface CognitionResponse { requestId: string; principalId: PrincipalId; correlationId: CorrelationId; result: AgentResult; modelId: string; answer?: string; createdAt: Timestamp; }
