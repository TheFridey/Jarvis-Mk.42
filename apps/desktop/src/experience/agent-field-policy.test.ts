import { describe, expect, it } from 'vitest';
import type { OperatingAgentJob } from '@jarvis/scene';
import { agentField } from './agent-field-policy.ts';

const job = (patch: Partial<OperatingAgentJob>): OperatingAgentJob => ({ jobId: 'j1', agentId: 'agents.forge', correlationId: 'c', taskClass: 'code', state: 'RUNNING', attempt: 1, deadline: '2026-10-03T11:00:00Z', budget: { wallMs: 1000, contextUnits: 1, costLimit: 1 }, proposalCount: 0, proposedCapabilities: [], evidenceRefs: [], ...patch });

describe('agent field policy', () => {
  it('shows only agents with projected jobs', () => {
    expect(agentField([], true).nodes).toEqual([]);
  });
  it('animates only current confirmed work', () => {
    expect(agentField([job({})], true).nodes[0]).toMatchObject({ name: 'FORGE', state: 'WORKING', animated: true });
    expect(agentField([job({ activityConfirmed: false })], true).nodes[0]).toMatchObject({ state: 'UNCONFIRMED', animated: false });
    expect(agentField([job({})], false).nodes[0]!.animated).toBe(false);
  });
  it('keeps orbit order stable when an agent changes state', () => {
    const order = (state: 'RUNNING' | 'QUEUED') => agentField([job({ jobId: 'a', agentId: 'agents.nova', state: 'QUEUED' }), job({ jobId: 'b', agentId: 'agents.forge', state })], true).nodes.map(node => node.agentId);
    expect(order('QUEUED')).toEqual(order('RUNNING'));
  });
  it('links orchestration parents and prefers the active job per agent', () => {
    const field = agentField([job({ jobId: 'p', agentId: 'agents.nova' }), job({ jobId: 'old', state: 'COMPLETE' }), job({ jobId: 'c', parentJobId: 'p' })], true);
    const forge = field.nodes.find(node => node.agentId === 'agents.forge')!;
    expect(forge).toMatchObject({ jobId: 'c', parentAgentId: 'agents.nova', jobCount: 2 });
    expect(forge.groups).toContain('ENGINEERING');
  });
});

it('counts outstanding work separately from history, so a finished job never reads as waiting', () => {
  const job = (jobId: string, state: string, extra: Record<string, unknown> = {}) => ({
    jobId, agentId: 'agents.oracle', correlationId: 'c', taskClass: 'reason', state, attempt: 1,
    activityStage: state, activityConfirmed: state === 'RUNNING', capabilityActivity: [],
    deadline: new Date().toISOString(), budget: { wallMs: 1000, contextUnits: 10, costLimit: 1 }, ...extra,
  });
  const { nodes, activeCount } = agentField([
    job('old-1', 'COMPLETE'), job('old-2', 'FAILED'), job('now', 'RUNNING'),
  ] as never, true);
  const oracle = nodes.find(node => node.agentId === 'agents.oracle')!;
  expect(oracle.jobCount).toBe(3);        // history is still visible
  expect(oracle.activeJobCount).toBe(1);  // the readout counts work, not archaeology
  expect(activeCount).toBe(1);
  expect(oracle.state).toBe('WORKING');
});
