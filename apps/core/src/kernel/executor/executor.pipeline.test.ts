import { describe, expect, it, vi } from 'vitest';
import type { Capability, CapabilityInvocationProposal, EventActor } from '@jarvis/contracts';
import { CapabilityExecutor } from './executor.ts';
import { VerificationRunner } from './verify-runner.ts';

const actor: EventActor = { kind: 'agent', id: 'forge', onBehalfOf: 'principal-1' };
const proposal = (proposalId: string): CapabilityInvocationProposal => ({
  proposalId,
  kind: 'capability_invocation',
  correlationId: 'correlation-1',
  confidence: 1,
  provenance: { method: 'system', producedBy: 'test', producedOn: 'node-1', producedAt: '2026-09-04T00:00:00Z', correlationId: 'correlation-1', derivedFromUntrusted: false },
  invocation: { capabilityId: 'capabilities.test', capabilityVersion: '1.0.0', action: 'write', input: { path: 'a.txt', content: 'expected' } },
  justification: 'test',
});
const capability: Capability = {
  id: 'capabilities.test', version: '1.0.0', description: 'test', provider: 'test', executionEnvironment: 'worker',
  auditPolicy: { hashInput: true, recordOutput: 'summary' }, privacyRequirements: { maxContentPrivacyClass: 'INTERNAL' }, requiredScopes: ['write'], trustTierMin: 'owned-secure', resourceKeySelector: '$.path',
  actions: [{ name: 'write', inputSchema: {}, outputSchema: {}, riskClass: 'MEDIUM', reversible: false, simulatable: false, verify: 'read', idempotent: true, sideEffects: ['write'], approvalPolicy: 'default', timeoutMs: 1000, verificationStrategy: { kind: 'state-echo', adapterRef: 'read' } }],
};

function executor(verdict: 'ALLOW' | 'REQUIRE_APPROVAL', approved: boolean, worldValue: unknown, selected:Capability=capability) {
  const execute = vi.fn(async () => ({ content: 'expected' }));
  const selfVerify = vi.fn(async () => ({ verified: true, checks: [] }));
  const events: string[] = [];
  const instance = new CapabilityExecutor({
    lookup: async () => selected,
    validateInput: () => true,
    evaluate: () => ({ verdict, firedRuleIds: [], rationale: verdict }),
    permission: { authorise: async () => ({ ok: true, approved, grantId: 'grant-1', grantVersion: 1, authorityToken: 'authority', verificationAuthorityToken: 'verify-authority', beforeAuthorityToken: 'before-authority' }), freshnessCheck: async () => 'ok' },
    broker: { mint: async (input) => ({ handleId: 'handle', invocationId: input.invocationId, scope: { capabilityId: input.capabilityId, action: input.action, resourceRef: input.resourceRef }, mode: input.mode, expiresAt: '2099-01-01T00:00:00Z', kind: 'derived' }) },
    adapter: () => ({ execute, verify: selfVerify }),
    verification: new VerificationRunner({ read: async () => worldValue, readPath: async () => worldValue, awaitEvent: async () => false }),
    events: { emit: async (type) => { events.push(type); return `event-${events.length}`; } },
  });
  return { instance, execute, selfVerify, events };
}

describe('CapabilityExecutor load-bearing controls', () => {
  it('does not execute while REQUIRE_APPROVAL lacks a recorded approval', async () => {
    const subject = executor('REQUIRE_APPROVAL', false, { content: 'expected' });
    const result = await subject.instance.invoke(proposal('proposal-pending'), actor);
    expect(result.outcome).toBe('awaiting_approval');
    expect(subject.execute).not.toHaveBeenCalled();
    expect(subject.events).not.toContain('jarvis.agency.invocation.started');
  });

  it('does not trust an adapter self-verification claim', async () => {
    const subject = executor('ALLOW', true, { content: 'different' });
    const result = await subject.instance.invoke(proposal('proposal-lie'), actor);
    expect(result.outcome).toBe('verification_failed');
    expect(subject.selfVerify).not.toHaveBeenCalled();
    expect(subject.events).not.toContain('jarvis.agency.invocation.verified');
  });

  it('deduplicates a retried proposal id', async () => {
    const subject = executor('ALLOW', true, { content: 'expected' });
    const first = await subject.instance.invoke(proposal('proposal-repeat'), actor);
    const second = await subject.instance.invoke(proposal('proposal-repeat'), actor);
    expect(first.invocationId).toBe(second.invocationId);
    expect(subject.execute).toHaveBeenCalledTimes(1);
  });
  it('forbids high-risk completion when verification is adapter self-report only',async()=>{const high:Capability={...capability,actions:[{...capability.actions[0]!,riskClass:'HIGH',verificationAssurance:'ADAPTER_SELF_REPORT'}]};const subject=executor('ALLOW',true,{content:'expected'},high);const result=await subject.instance.invoke(proposal('proposal-high-self-report'),actor);expect(result.outcome).toBe('aborted');expect(subject.execute).not.toHaveBeenCalled()});
});
