import { describe, expect, it } from 'vitest';
import { DEMO_SEQUENCES, sequenceSteps } from './demo-sequences.ts';
import { resolveExperiencePhase, resolveLiveness } from './experience-phase-policy.ts';
import type { DesktopKernelSnapshot } from '@jarvis/scene';

function phases(sequence: typeof DEMO_SEQUENCES[number]) {
  let last: DesktopKernelSnapshot | undefined;
  return sequenceSteps(sequence).map(step => {
    const now = 1_700_000_000_000 + step.at;
    if (step.snapshot) last = step.snapshot(now);
    return resolveExperiencePhase(last, resolveLiveness(step.connection(now), true));
  });
}

describe('demo motion sequences', () => {
  it('walk the brief transitions through the normal phase resolver', () => {
    expect(phases('conversation')).toEqual(['DORMANT', 'LISTENING', 'THINKING', 'ROUTING', 'MODEL_ACTIVE', 'RESPONDING', 'DORMANT']);
    expect(phases('fallback')).toEqual(['ROUTING', 'MODEL_ACTIVE', 'ROUTING', 'FALLBACK', 'MODEL_ACTIVE']);
    expect(phases('execution')).toEqual(['THINKING', 'THINKING', 'EXECUTING', 'APPROVAL', 'EXECUTING', 'VERIFYING', 'COMPLETE', 'DORMANT']);
    expect(phases('liveness')).toEqual(['MODEL_ACTIVE', 'COMM_LOSS', 'COMM_LOSS']);
  });

  it('are deterministic and ordered', () => {
    for (const sequence of DEMO_SEQUENCES) {
      const steps = sequenceSteps(sequence);
      expect(steps.map(step => step.at)).toEqual([...steps.map(step => step.at)].sort((a, b) => a - b));
      expect(phases(sequence)).toEqual(phases(sequence));
    }
  });

  it('name only synthetic demo models, agents and providers', () => {
    for (const sequence of DEMO_SEQUENCES) {
      for (const step of sequenceSteps(sequence)) {
        const snapshot = step.snapshot?.(1_700_000_000_000);
        if (!snapshot) continue;
        for (const run of [...snapshot.activeModels, ...snapshot.recentModelRuns]) {
          for (const id of [run.modelId, ...(run.routing?.candidates ?? []).map(candidate => candidate.modelId)]) if (id) expect(id).toMatch(/^demo-/);
          for (const candidate of run.routing?.candidates ?? []) expect(candidate.provider).toMatch(/^demo-/);
        }
        expect(snapshot.pendingApprovals.every(item => item.id.startsWith('demo-'))).toBe(true);
      }
    }
  });
});
