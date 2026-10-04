import { describe, expect, it } from 'vitest';
import { activeTransitions, emptyChoreography, modelChoreography, observeRoute, sceneChoreography, TRANSITION_SPAN_MS, windowProgress, type RouteSnapshot } from './transition-choreography.ts';

const snap = (partial: Partial<RouteSnapshot>): RouteSnapshot => ({ requestId: 'r1', current: true, fallback: false, failedIds: [], candidateIds: [], localities: { a: 'cloud-ok', b: 'cloud-ok', l: 'local' }, ...partial });

describe('transition choreography', () => {
  it('records nothing when the observation does not change', () => {
    const first = observeRoute(emptyChoreography(), snap({ selectedModelId: 'a' }), 0);
    const again = observeRoute(first, snap({ selectedModelId: 'a' }), 500);
    expect(again.transitions).toHaveLength(1);
    expect(again.transitions[0]!.kind).toBe('acquire');
  });

  it('turns a change of selection into a switch with the brief timing windows', () => {
    let state = observeRoute(emptyChoreography(), snap({ selectedModelId: 'a' }), 0);
    state = observeRoute(state, snap({ selectedModelId: 'b', candidateIds: ['a'] }), 10_000);
    const transition = activeTransitions(state, 10_100)[0]!;
    expect(transition).toMatchObject({ kind: 'switch', from: 'a', to: 'b', crossesBoundary: false });
    // A decays first: energy gone by 250ms, appearance retained until 1500ms.
    expect(modelChoreography(state, 'a', 10_000, false)).toMatchObject({ energy: 1, retain: 1 });
    expect(modelChoreography(state, 'a', 10_250, false).energy).toBe(0);
    expect(modelChoreography(state, 'a', 10_900, false).retain).toBe(1);
    expect(modelChoreography(state, 'a', 11_500, false).retain).toBe(0);
    // B locks between 550 and 950ms and only pulses once the result window opens.
    expect(modelChoreography(state, 'b', 10_550, false).lock).toBe(0);
    expect(modelChoreography(state, 'b', 10_950, false).lock).toBe(1);
    expect(modelChoreography(state, 'b', 10_700, false).pulse).toBe(0);
  });

  it('marks a locality change as crossing the boundary and exposes the crossing pulse', () => {
    let state = observeRoute(emptyChoreography(), snap({ selectedModelId: 'a' }), 0);
    state = observeRoute(state, snap({ selectedModelId: 'l', fallback: true, failedIds: ['a'] }), 5_000);
    expect(state.transitions.at(-1)).toMatchObject({ kind: 'fallback', from: 'a', to: 'l', crossesBoundary: true });
    expect(sceneChoreography(state, 5_700, false).crossing).toMatchObject({ from: 'a', to: 'l' });
    expect(sceneChoreography(state, 6_300, false).crossing).toBeUndefined();
    // The failed primary loses coherence from the moment the fallback is observed.
    expect(modelChoreography(state, 'a', 5_000, false).fracture).toBe(0);
    expect(modelChoreography(state, 'a', 5_450, false).fracture).toBe(1);
  });

  it('only returns result energy when the same request finishes', () => {
    let state = observeRoute(emptyChoreography(), snap({ selectedModelId: 'a' }), 0);
    state = observeRoute(state, snap({ current: false }), 3_000);
    expect(state.transitions.at(-1)).toMatchObject({ kind: 'result', from: 'a' });
    expect(sceneChoreography(state, 3_600, false).coreReturn).toBe(0);
    expect(sceneChoreography(state, 3_950, false).coreReturn).toBeGreaterThan(.9);
    let other = observeRoute(emptyChoreography(), snap({ selectedModelId: 'a' }), 0);
    other = observeRoute(other, snap({ requestId: 'r2', current: false }), 3_000);
    expect(other.transitions.some(item => item.kind === 'result')).toBe(false);
  });

  it('collapses to settled values under reduced motion', () => {
    let state = observeRoute(emptyChoreography(), snap({ selectedModelId: 'a' }), 0);
    state = observeRoute(state, snap({ selectedModelId: 'b' }), 1_000);
    expect(modelChoreography(state, 'b', 1_000, true)).toMatchObject({ lock: 1, pulse: 1, retain: 0 });
    expect(modelChoreography(state, 'a', 1_000, true)).toMatchObject({ retain: 0, energy: 0 });
    expect(sceneChoreography(state, 1_500, true)).toEqual({ coreReturn: 0 });
  });

  it('is deterministic and expires transitions after the span', () => {
    const run = () => observeRoute(observeRoute(emptyChoreography(), snap({ selectedModelId: 'a' }), 0), snap({ selectedModelId: 'b' }), 100);
    expect(run()).toEqual(run());
    const later = observeRoute(run(), snap({ selectedModelId: 'a' }), 100 + TRANSITION_SPAN_MS + 1);
    expect(later.transitions.map(item => item.kind)).toEqual(['switch']);
    expect(windowProgress(-1, [0, 10])).toBe(0);
    expect(windowProgress(11, [0, 10])).toBe(1);
  });
});
