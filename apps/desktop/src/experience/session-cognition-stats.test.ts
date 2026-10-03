import { describe, expect, it } from 'vitest';
import type { OperatingModelRun } from '@jarvis/scene';
import { emptySessionStats, observeRuns, sessionTotals } from './session-cognition-stats.ts';

const run = (patch: Partial<OperatingModelRun>): OperatingModelRun => ({ requestId: 'r1', correlationId: 'c', modelId: 'm', agentId: 'agents.nova', status: 'running', startedAt: '2026-10-03T10:00:00Z', ...patch });

describe('session cognition stats', () => {
  it('counts each observed request once and usage only at completion', () => {
    let stats = emptySessionStats(new Date('2026-10-03T10:00:00Z'));
    stats = observeRuns(stats, [run({})]);
    stats = observeRuns(stats, [run({})]);
    expect(stats.models.m!.requests).toBe(1);
    expect(stats.models.m!.inputTokens).toBeUndefined();
    stats = observeRuns(stats, [run({ status: 'completed', usage: { contextUnits: 1, outputUnits: 1, costEstimate: .01, latencyMs: 800, inputTokens: 100, outputTokens: 20 } })]);
    stats = observeRuns(stats, [run({ status: 'completed', usage: { contextUnits: 1, outputUnits: 1, costEstimate: .01, latencyMs: 800, inputTokens: 100, outputTokens: 20 } })]);
    expect(stats.models.m).toMatchObject({ requests: 1, completed: 1, inputTokens: 100, outputTokens: 20, costEstimate: .01, latencySamples: 1 });
  });
  it('keeps unreported tokens unknown instead of zero', () => {
    const stats = observeRuns(emptySessionStats(), [run({ status: 'completed', usage: { contextUnits: 1, outputUnits: 1, costEstimate: 0, latencyMs: 10 } })]);
    const totals = sessionTotals(stats);
    expect(totals.tokens).toBeUndefined();
    expect(totals.tokensUnreported).toBe(1);
  });
  it('counts fallbacks reported by routing', () => {
    const stats = observeRuns(emptySessionStats(), [run({ routing: { phase: 'FALLBACK', candidates: [] } as never })]);
    expect(sessionTotals(stats).fallbacks).toBe(1);
  });
  it('ignores runs without an observed model', () => {
    const stats = emptySessionStats();
    expect(observeRuns(stats, [run({ modelId: null })])).toBe(stats);
  });
});
