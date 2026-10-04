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
