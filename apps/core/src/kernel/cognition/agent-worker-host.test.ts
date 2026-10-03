import { describe, expect, it, vi } from 'vitest';
import { runAgentWorker } from './agent-worker-host.ts';
import type { ModelRequest, ModelResponse } from '@jarvis/contracts';
const request: ModelRequest = { task: 'reason', capabilities: ['json'], input: { instruction: 'test', context: {} as never, constraints: [] }, budget: { contextUnits: 1, maxOutput: 10 }, locality: 'local', principalId: 'p', correlationId: 'c' };
const response: ModelResponse = { modelId: 'fixture', output: { proposals: [] }, usage: { contextUnits: 1, outputUnits: 1, costEstimate: 0, latencyMs: 1 }, finishReason: 'stop', provenance: { method: 'model', producedBy: 'fixture', producedOn: 'test', producedAt: new Date().toISOString(), correlationId: 'c', derivedFromUntrusted: true } };
describe('credentialless process boundary', () => {
  it('does not inherit parent credentials or filesystem/child-process authority', async () => {
    vi.stubEnv('JARVIS_WORKER_SECRET_PROBE','test-only-not-a-real-credential');
    let checked = false;
    try {
      await runAgentWorker({ jobId:'isolation',request,signal:AbortSignal.timeout(5000),onSpawn:async()=>{},heartbeat:async()=>{},beforeInference:async()=>{},
        onIsolation:boundary=>{checked=true;expect(boundary.environmentKeys).not.toContain('JARVIS_WORKER_SECRET_PROBE');expect(boundary).toMatchObject({canWriteFiles:false,canSpawnChildren:false,canReadWorkspace:false});},
        gateway:{async generate(){return response;}} });
      expect(checked).toBe(true);
    } finally { vi.unstubAllEnvs(); }
  });
  it('mediates exactly one immutable model request and reaps the worker', async () => {
    let calls = 0, pid = 0;
    const actual = await runAgentWorker({ jobId: 'job', request, signal: AbortSignal.timeout(5000), onSpawn: async value => { pid = value; }, heartbeat: async () => {}, beforeInference: async () => {}, gateway: { async generate(input) { expect(input).toBe(request); calls++; return response; } } });
    expect(actual).toEqual(response); expect(calls).toBe(1); expect(pid).toBeGreaterThan(0);
  });
  it('cancels a live worker and aborts mediated inference without returning proposals', async () => {
    const controller = new AbortController(); let aborted = false;
    const promise = runAgentWorker({ jobId: 'cancel', request, signal: controller.signal, onSpawn: async () => {}, heartbeat: async () => {}, beforeInference: async () => {}, gateway: { generate(_input, signal) { return new Promise((_resolve, reject) => { signal!.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); }, { once: true }); controller.abort(); }); } } });
    await expect(promise).rejects.toThrow('cancelled'); expect(aborted).toBe(true);
  });
});
