import { describe, it, expect } from 'vitest';
import { carriesPersonalContext } from './companion-service.ts';

/**
 * The Kernel classifies its own outbound context. These tests exist because that classification was
 * missing in production: the orchestrator read `memoryBearing`, nothing ever set it, so the Gateway's
 * fallback guard was arming on a flag that only tests supplied.
 */
describe('disclosure classification', () => {
  it('treats a verified memory block as personal context', () => {
    expect(carriesPersonalContext({ memoryBlock: 'Approved context about the owner', historyTurns: 0, publicWeb: false })).toBe(true);
  });

  it('treats conversation history as personal even with no freshly selected memory', () => {
    // Revocation cannot remove what a previous turn already sent, so history stays protected.
    expect(carriesPersonalContext({ memoryBlock: '', historyTurns: 1, publicWeb: false })).toBe(true);
  });

  it('leaves an empty first turn unprotected', () => {
    expect(carriesPersonalContext({ memoryBlock: '', historyTurns: 0, publicWeb: false })).toBe(false);
  });

  it('never treats public-web analysis as personal context', () => {
    expect(carriesPersonalContext({ memoryBlock: 'Approved context about the owner', historyTurns: 3, publicWeb: true })).toBe(false);
  });
});
