import { describe, expect, it } from 'vitest';
import { boundedOutput, MAX_COGNITION_OUTPUT } from './cognition-orchestrator.ts';

describe('output token policy', () => {
  it('defaults to the authoritative ceiling when no hint is given', () => {
    expect(boundedOutput()).toBe(MAX_COGNITION_OUTPUT);
    expect(boundedOutput(undefined)).toBe(MAX_COGNITION_OUTPUT);
  });

  it('honours a smaller request', () => {
    expect(boundedOutput(256)).toBe(256);
    expect(boundedOutput(1)).toBe(1);
  });

  it('refuses to raise the ceiling above policy', () => {
    expect(boundedOutput(MAX_COGNITION_OUTPUT + 1)).toBe(MAX_COGNITION_OUTPUT);
    expect(boundedOutput(1_000_000)).toBe(MAX_COGNITION_OUTPUT);
  });

  it('treats nonsense as no preference rather than failing the turn', () => {
    expect(boundedOutput(Number.NaN)).toBe(MAX_COGNITION_OUTPUT);
    expect(boundedOutput(Number.POSITIVE_INFINITY)).toBe(MAX_COGNITION_OUTPUT);
    expect(boundedOutput(0)).toBe(MAX_COGNITION_OUTPUT);
    expect(boundedOutput(-50)).toBe(MAX_COGNITION_OUTPUT);
  });

  it('floors fractional values instead of rounding up', () => {
    expect(boundedOutput(255.9)).toBe(255);
  });
});
