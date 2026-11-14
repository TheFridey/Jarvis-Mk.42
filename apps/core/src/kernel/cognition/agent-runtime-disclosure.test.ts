import { expect, it } from 'vitest';
import { AgentRuntime } from './agent-runtime.ts';
import type { ModelRequest } from '@jarvis/contracts';

/**
 * `runAgentWorker` is invoked twice when the first structured response fails schema validation. That
 * second invocation replays the same prompt, which is a retransmission no matter which layer starts
 * it - the Gateway's fallback guard never sees it because it is a fresh request, not a fallback.
 * These tests pin the rule: a protected request gets exactly one inference, and an unprotected one
 * keeps its repair pass.
 */
const base: ModelRequest = {
  task: 'reason',
  capabilities: ['json'],
  input: { instruction: 'test', context: {} as never, constraints: [] },
  budget: { contextUnits: 10, maxOutput: 10 },
  locality: 'local',
  principalId: 'p',
  correlationId: 'c',
};

const malformed = () => new AgentRuntime({
  async generate() {
    return {
      modelId: 'fixture',
      output: { proposals: [{ proposalId: 'p1', kind: 'answer' }], evidence: [] },
      usage: { contextUnits: 1, outputUnits: 1, costEstimate: 0, latencyMs: 1 },
      finishReason: 'stop',
      provenance: { method: 'model', producedBy: 'fixture', producedOn: 'test', producedAt: new Date().toISOString(), correlationId: 'c', derivedFromUntrusted: true } as never,
    };
  },
}, () => new Date().toISOString());

it('never repairs a protected request: exactly one inference, and it says why', async () => {
  let calls = 0;
  const runtime = new AgentRuntime({
    async generate() {
      calls++;
      return {
        modelId: 'fixture',
        output: { proposals: [{ proposalId: 'p1', kind: 'answer' }] },
        usage: { contextUnits: 1, outputUnits: 1, costEstimate: 0, latencyMs: 1 },
        finishReason: 'stop',
        provenance: {} as never,
      };
    },
  }, () => new Date().toISOString());
  await expect(runtime.invoke('agents.oracle', { ...base, disclosure: 'personal-memory' })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  expect(calls).toBe(1);
});

it('refuses the repair pass for a protected request with a truthful message', async () => {
  await expect(malformed().invoke('agents.oracle', { ...base, disclosure: 'personal-memory' }))
    .rejects.toThrow(/repair retransmission was refused for a personal-memory request/);
});

it('still allows exactly one repair pass for an unprotected request', async () => {
  let calls = 0;
  const runtime = new AgentRuntime({
    async generate() {
      calls++;
      return {
        modelId: 'fixture',
        output: calls === 1 ? { proposals: [{ proposalId: 'p1', kind: 'answer' }] } : { proposals: [] },
        usage: { contextUnits: 1, outputUnits: 1, costEstimate: 0, latencyMs: 1 },
        finishReason: 'stop',
        provenance: {} as never,
      };
    },
  }, () => new Date().toISOString());
  await runtime.invoke('agents.oracle', base);
  expect(calls).toBe(2);
});
