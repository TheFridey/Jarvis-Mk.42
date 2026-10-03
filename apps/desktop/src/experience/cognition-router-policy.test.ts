import { describe, expect, it } from 'vitest';
import type { ModelRouteCandidate } from '@jarvis/contracts';
import type { OperatingModelRun } from '@jarvis/scene';
import { cognitionRouterView, modelGlyph, modelIdentityRows } from './cognition-router-policy.ts';

const candidate = (modelId: string, state: ModelRouteCandidate['state'], locality: ModelRouteCandidate['locality'] = 'local'): ModelRouteCandidate => ({ modelId, displayName: modelId, provider: 'p', locality, state, reason: 'r', contextLimitUnits: 1000, toolSupport: true, visionSupport: false, healthState: 'healthy', circuitBreaker: 'closed' });
const run = (patch: Partial<OperatingModelRun> = {}): OperatingModelRun => ({ requestId: 'r1', correlationId: 'c1', modelId: 'b', agentId: 'agents.nova', status: 'running', startedAt: '2026-10-03T10:00:00Z', ...patch });
const routing = (candidates: ModelRouteCandidate[], patch: object = {}) => ({ schemaVersion: 1, correlationId: 'c1', taskClass: 'reason', privacyClass: 'INTERNAL', startedAt: '2026-10-03T10:00:00Z', candidates, fallbackModelIds: [], ...patch }) as OperatingModelRun['routing'];

describe('cognition router policy', () => {
  it('builds nodes only from observed routing candidates', () => {
    expect(cognitionRouterView([], [], true).nodes).toEqual([]);
    const view = cognitionRouterView([run({ routing: routing([candidate('a', 'CANDIDATE'), candidate('b', 'SELECTED')], { selectedModelId: 'b', phase: 'STARTING' }) })], [], true);
    expect(view.nodes.map(node => [node.modelId, node.route])).toEqual([['a', 'REJECTED'], ['b', 'SELECTED']]);
  });
  it('distinguishes awaiting first token from confirmed streaming', () => {
    const base = routing([candidate('b', 'SELECTED')], { selectedModelId: 'b', phase: 'STARTING' });
    expect(cognitionRouterView([run({ routing: base })], [], true).nodes[0]!.activity).toBe('awaiting-first-token');
    expect(cognitionRouterView([run({ routing: base, firstTokenAt: '2026-10-03T10:00:01Z' })], [], true).nodes[0]!.activity).toBe('inferring');
    expect(cognitionRouterView([run({ routing: base, activityConfirmed: false })], [], true).nodes[0]!.activity).toBe('unconfirmed');
  });
  it('reports fallback and locality shift only from routing observations', () => {
    const view = cognitionRouterView([run({ routing: routing([candidate('a', 'FAILED', 'cloud-ok'), candidate('b', 'FALLBACK')], { selectedModelId: 'b', phase: 'FALLBACK', fallbackReason: 'timeout' }) })], [], true);
    expect(view.route).toMatchObject({ fallback: true, failedIds: ['a'], localityShift: { from: 'cloud-ok', to: 'local' } });
    expect(view.nodes.find(node => node.modelId === 'b')).toMatchObject({ route: 'SELECTED', viaFallback: true });
    const plain = cognitionRouterView([run({ routing: routing([candidate('b', 'SELECTED')], { selectedModelId: 'b', phase: 'STARTING' }) })], [], true);
    expect(plain.route?.fallback).toBe(false);
  });
  it('turns every node historical when disconnected', () => {
    const view = cognitionRouterView([run({ routing: routing([candidate('b', 'SELECTED')], { selectedModelId: 'b', phase: 'STARTING' }) })], [], false);
    expect(view.nodes[0]).toMatchObject({ route: 'HISTORICAL', activity: 'stale' });
  });
  it('computes context pressure only when used and limit are both observed', () => {
    const r = run({ usage: { contextUnits: 250, outputUnits: 1, costEstimate: 0, latencyMs: 1 }, routing: routing([candidate('b', 'SELECTED')], { selectedModelId: 'b', phase: 'STARTING' }) });
    expect(cognitionRouterView([r], [], true).nodes[0]!.contextRatio).toBe(.25);
    expect(cognitionRouterView([run({ routing: routing([candidate('b', 'SELECTED')], { selectedModelId: 'b' }) })], [], true).nodes[0]!.contextRatio).toBeUndefined();
  });
  it('shows UNAVAILABLE rather than zero in the identity projection', () => {
    const r = run({ routing: routing([candidate('b', 'SELECTED')], { selectedModelId: 'b' }) });
    const node = cognitionRouterView([r], [], true).nodes[0]!;
    const rows = Object.fromEntries(modelIdentityRows(node, r, false));
    expect(rows['TOKENS IN / OUT']).toBe('UNAVAILABLE');
    expect(rows['EST. COST']).toBe('UNAVAILABLE');
    expect(rows.CORRELATION).toBeUndefined();
  });
  it('derives typographic glyphs', () => {
    expect(modelGlyph('Demo Local 8B')).toBe('DL8B');
    expect(modelGlyph('reasoner')).toBe('REA');
  });
});
