import type { CorrelationId, Timestamp } from './common.ts';
import type { Proposal } from './proposal.ts';
export interface AgentResult { jobId: string; agentId: string; principalId: string; correlationId: CorrelationId; status: 'completed' | 'failed' | 'timed_out' | 'cancelled'; proposals: Proposal[]; evidence: string[]; startedAt: Timestamp; finishedAt: Timestamp; error?: { code: string; message: string }; }
