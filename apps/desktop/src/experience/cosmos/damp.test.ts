import { describe, expect, it } from 'vitest';
import { damp, dampAngle } from './damp.ts';

describe('damped GPU interpolation', () => {
  it('approaches targets without overshoot and independent of frame rate', () => {
    let a = 0, b = 0;
    for (let i = 0; i < 60; i++) a = damp(a, 1, 2, 1 / 60);
    for (let i = 0; i < 30; i++) b = damp(b, 1, 2, 1 / 30);
    expect(a).toBeLessThan(1);
    expect(Math.abs(a - b)).toBeLessThan(1e-9);
  });
  it('snaps with infinite rate and holds with no elapsed time', () => {
    expect(damp(0, 1, Number.POSITIVE_INFINITY, .016)).toBe(1);
    expect(damp(.3, 1, 2, 0)).toBe(.3);
    expect(dampAngle(0, 1, Number.POSITIVE_INFINITY, 0)).toBe(1);
    expect(dampAngle(.3, 1, 2, 0)).toBe(.3);
  });
  it('turns the short way around the circle', () => {
    expect(dampAngle(Math.PI * .95, -Math.PI * .95, 1000, .1)).toBeCloseTo(Math.PI * 1.05, 3);
  });
});
