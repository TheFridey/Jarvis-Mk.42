import { AGENT_ORCHESTRATION_GROUPS, type OperatingAgentJob } from '@jarvis/scene';

export type AgentNodeState = 'QUEUED' | 'LEASED' | 'WORKING' | 'WAITING' | 'BLOCKED' | 'COMPLETE' | 'FAILED' | 'CANCELLED' | 'UNCONFIRMED';
export interface AgentNode {
  agentId: string;
  name: string;
  state: AgentNodeState;
  /** Motion is allowed only for a current, confirmed lease or run. */
  animated: boolean;
  groups: string[];
  jobId: string;
  parentAgentId?: string;
  taskClass: string;
  modelId?: string;
  stage?: string;
  jobCount: number;
}

const ACTIVE: OperatingAgentJob['state'][] = ['RUNNING', 'LEASED', 'WAITING', 'QUEUED', 'BLOCKED'];
const rank = (job: OperatingAgentJob) => { const index = ACTIVE.indexOf(job.state); return index < 0 ? ACTIVE.length : index; };

export function agentNodeState(job: OperatingAgentJob): AgentNodeState {
  if ((job.state === 'RUNNING' || job.state === 'WAITING' || job.state === 'LEASED') && job.activityConfirmed === false) return 'UNCONFIRMED';
  return job.state === 'RUNNING' ? 'WORKING' : job.state;
}

/** Agents appear only when the projection carries a job for them. */
export function agentField(jobs: OperatingAgentJob[], current: boolean, limit = 8): { nodes: AgentNode[]; activeCount: number } {
  const byAgent = new Map<string, OperatingAgentJob[]>();
  for (const job of jobs) byAgent.set(job.agentId, [...(byAgent.get(job.agentId) ?? []), job]);
  const jobAgent = new Map(jobs.map(job => [job.jobId, job.agentId]));
  const nodes: AgentNode[] = [...byAgent.entries()].map(([agentId, list]) => {
    const job = [...list].sort((a, b) => rank(a) - rank(b))[0]!;
    const state = agentNodeState(job);
    const parentAgentId = job.parentJobId ? jobAgent.get(job.parentJobId) : undefined;
    return {
      agentId, name: agentId.replace(/^agents\./, '').toUpperCase(), state,
      animated: current && (state === 'WORKING' || state === 'LEASED'),
      groups: Object.entries(AGENT_ORCHESTRATION_GROUPS).filter(([, agents]) => (agents as readonly string[]).includes(agentId)).map(([group]) => group),
      jobId: job.jobId, taskClass: job.taskClass,
      ...(parentAgentId && parentAgentId !== agentId ? { parentAgentId } : {}),
      ...(job.selectedModelId ? { modelId: job.selectedModelId } : {}),
      ...(job.activityStage ? { stage: job.activityStage } : {}),
      jobCount: list.length,
    };
  });
  // The limit favours animated work, but orbit order is by identity so a state change never swaps two agents' slots.
  const shown = [...nodes].sort((a, b) => Number(b.animated) - Number(a.animated)).slice(0, limit).sort((a, b) => a.agentId.localeCompare(b.agentId));
  return { nodes: shown, activeCount: nodes.filter(node => node.animated).length };
}
