import type { OperatingModelRun } from '@jarvis/scene';
import { isFallbackRun } from './cognition-router-policy.ts';

/**
 * Presentation-only, in-memory aggregation of model runs this desktop session
 * actually observed. Not authoritative, not persisted; resets on restart and is
 * always labelled session-scoped. Unknown usage stays unknown (never zero).
 */
export interface ModelSessionStats {
  modelId: string;
  requests: number;
  completed: number;
  failed: number;
  fallbacks: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  /** Terminal runs that reported no token counts. */
  tokensUnreported: number;
  costEstimate?: number;
  actualCost?: number;
  latencyTotalMs: number;
  latencySamples: number;
}
export interface SessionCognitionStats {
  since: string;
  seen: Record<string, 'running' | 'terminal'>;
  models: Record<string, ModelSessionStats>;
}

export function emptySessionStats(now: Date = new Date()): SessionCognitionStats {
  return { since: now.toISOString(), seen: {}, models: {} };
}

const add = (a: number | undefined, b: number | undefined) => b === undefined ? a : (a ?? 0) + b;

export function observeRuns(stats: SessionCognitionStats, runs: OperatingModelRun[]): SessionCognitionStats {
  let changed = false;
  const seen = { ...stats.seen };
  const models = { ...stats.models };
  for (const run of runs) {
    const modelId = run.modelId ?? run.routing?.selectedModelId;
    if (!modelId) continue;
    const prior = seen[run.requestId];
    const terminal = run.status !== 'running';
    if (prior === 'terminal' || (prior === 'running' && !terminal)) continue;
    const model = { ...(models[modelId] ?? { modelId, requests: 0, completed: 0, failed: 0, fallbacks: 0, tokensUnreported: 0, latencyTotalMs: 0, latencySamples: 0 }) };
    if (!prior) {
      model.requests++;
      if (isFallbackRun(run)) model.fallbacks++;
    }
    if (terminal) {
      if (run.status === 'completed') model.completed++; else model.failed++;
      const usage = run.usage;
      if (usage?.inputTokens === undefined && usage?.outputTokens === undefined) model.tokensUnreported++;
      const input = add(model.inputTokens, usage?.inputTokens); if (input !== undefined) model.inputTokens = input;
      const output = add(model.outputTokens, usage?.outputTokens); if (output !== undefined) model.outputTokens = output;
      const cached = add(model.cachedTokens, usage?.cachedTokens); if (cached !== undefined) model.cachedTokens = cached;
      const estimate = add(model.costEstimate, usage?.costEstimate ?? run.costEstimate); if (estimate !== undefined) model.costEstimate = estimate;
      const actual = add(model.actualCost, usage?.actualCost); if (actual !== undefined) model.actualCost = actual;
      const latency = usage?.latencyMs ?? run.latencyMs;
      if (latency !== undefined && Number.isFinite(latency)) { model.latencyTotalMs += latency; model.latencySamples++; }
    }
    seen[run.requestId] = terminal ? 'terminal' : 'running';
    models[modelId] = model;
    changed = true;
  }
  return changed ? { since: stats.since, seen, models } : stats;
}

export interface SessionTotals {
  requests: number; completed: number; failed: number; fallbacks: number;
  tokens?: number; cachedTokens?: number; costEstimate?: number; actualCost?: number;
  averageLatencyMs?: number; tokensUnreported: number; modelShare: Array<{ modelId: string; share: number }>;
}

export function sessionTotals(stats: SessionCognitionStats): SessionTotals {
  const list = Object.values(stats.models);
  const requests = list.reduce((sum, model) => sum + model.requests, 0);
  let tokens: number | undefined; let cachedTokens: number | undefined; let costEstimate: number | undefined; let actualCost: number | undefined;
  for (const model of list) {
    tokens = add(add(tokens, model.inputTokens), model.outputTokens);
    cachedTokens = add(cachedTokens, model.cachedTokens);
    costEstimate = add(costEstimate, model.costEstimate);
    actualCost = add(actualCost, model.actualCost);
  }
  const samples = list.reduce((sum, model) => sum + model.latencySamples, 0);
  const latency = list.reduce((sum, model) => sum + model.latencyTotalMs, 0);
  return {
    requests, completed: list.reduce((s, m) => s + m.completed, 0), failed: list.reduce((s, m) => s + m.failed, 0), fallbacks: list.reduce((s, m) => s + m.fallbacks, 0),
    ...(tokens !== undefined ? { tokens } : {}), ...(cachedTokens !== undefined ? { cachedTokens } : {}),
    ...(costEstimate !== undefined ? { costEstimate } : {}), ...(actualCost !== undefined ? { actualCost } : {}),
    ...(samples ? { averageLatencyMs: latency / samples } : {}),
    tokensUnreported: list.reduce((s, m) => s + m.tokensUnreported, 0),
    modelShare: list.map(model => ({ modelId: model.modelId, share: requests ? model.requests / requests : 0 })).sort((a, b) => b.share - a.share),
  };
}
