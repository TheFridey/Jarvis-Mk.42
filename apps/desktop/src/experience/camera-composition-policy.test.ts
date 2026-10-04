import { describe, expect, it } from 'vitest';
import { applyFraming, framingTarget, MAX_BIAS_FRACTION, MAX_FRAMING_SCALE } from './camera-composition-policy.ts';
import type { ExperiencePhase } from './experience-phase-policy.ts';
import { spatialLayout } from './spatial-layout-policy.ts';

const layout = spatialLayout({ width: 1920, height: 1080, models: [{ locality: 'cloud-ok' }, { locality: 'local' }], agentCount: 2 });
const PHASES: ExperiencePhase[] = ['DORMANT', 'LISTENING', 'THINKING', 'ROUTING', 'MODEL_ACTIVE', 'FALLBACK', 'EXECUTING', 'APPROVAL', 'VERIFYING', 'COMPLETE', 'DEGRADED', 'CRITICAL', 'COMM_LOSS'];

describe('camera composition policy', () => {
  it('stays within the subtle framing limits for every phase', () => {
    for (const phase of PHASES) {
      const framing = framingTarget(phase, layout, false);
      expect(framing.scale).toBeLessThanOrEqual(MAX_FRAMING_SCALE);
      expect(Math.abs(framing.bias.x)).toBeLessThanOrEqual(layout.width * MAX_BIAS_FRACTION);
      expect(Math.abs(framing.bias.y)).toBeLessThanOrEqual(layout.width * MAX_BIAS_FRACTION);
    }
  });

  it('biases the view toward the region the phase is about', () => {
    // The scene shifts so the region drifts toward centre: models sit right of the Core, execution lower left.
    expect(framingTarget('ROUTING', layout, false).bias.x).toBeLessThan(0);
    expect(framingTarget('EXECUTING', layout, false).bias.x).toBeGreaterThan(0);
    expect(framingTarget('EXECUTING', layout, false).bias.y).toBeLessThan(0);
    expect(framingTarget('THINKING', layout, false).scale).toBeGreaterThan(1);
  });

  it('never shakes or reframes degraded and critical states', () => {
    for (const phase of ['DEGRADED', 'CRITICAL', 'COMM_LOSS'] as const) expect(framingTarget(phase, layout, false)).toMatchObject({ scale: 1, bias: { x: 0, y: 0 } });
  });

  it('disables framing under reduced motion and holds narrow layouts nearly still', () => {
    const reduced = framingTarget('ROUTING', layout, true);
    expect(reduced).toMatchObject({ scale: 1, bias: { x: 0, y: 0 } });
    const narrow = spatialLayout({ width: 900, height: 900, models: [], agentCount: 0 });
    expect(framingTarget('ROUTING', narrow, false).bias).toEqual({ x: 0, y: 0 });
  });

  it('applies the identical transform the DOM layer uses', () => {
    const framing = framingTarget('THINKING', layout, false);
    const core = applyFraming(layout.core, framing);
    expect(core.x).toBeCloseTo(layout.core.x);
    expect(core.y).toBeCloseTo(layout.core.y);
  });
});
