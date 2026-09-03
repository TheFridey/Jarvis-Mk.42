import { describe, expect, it } from 'vitest';
import { LEGAL_INVOCATION_TRANSITIONS, TERMINAL_INVOCATION_STATES } from './agency.ts';

describe('invocation lifecycle table', () => {
  it('gives every non-terminal state a successor and no terminal a successor', () => {
    for (const [state, next] of Object.entries(LEGAL_INVOCATION_TRANSITIONS)) {
      expect(next.length === 0).toBe((TERMINAL_INVOCATION_STATES as readonly string[]).includes(state));
    }
  });

  it('uses exactly the documented terminals', () => {
    expect([...TERMINAL_INVOCATION_STATES].sort()).toEqual(
      ['ABORTED', 'COMPLETED', 'DENIED', 'FAILED', 'PARTIALLY_COMPLETED', 'REJECTED', 'ROLLED_BACK', 'VERIFICATION_FAILED'].sort(),
    );
  });
});
