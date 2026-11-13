import { describe, expect, it } from 'vitest';
import { routingPolicy } from './cognition-orchestrator.ts';

/**
 * Adversarial cases for the privacy ceiling. These encode the rules that must hold no
 * matter what a client asks for: content outranks preference, and unknown-or-sensitive
 * material never reaches a provider.
 */
const base = { cloudAllowed: true, localModelAvailable: true } as const;

describe('privacy routing policy', () => {
  it('sends a public request where the caller asked', () => {
    expect(routingPolicy({ ...base, privacyClass: 'PUBLIC', requestedLocality: 'cloud-ok' }))
      .toEqual({ locality: 'cloud-ok', cloudAllowed: true });
  });

  it('defaults to "any" when the caller expresses no preference', () => {
    expect(routingPolicy({ ...base, privacyClass: 'INTERNAL' })).toEqual({ locality: 'any', cloudAllowed: true });
  });

  it('a caller cannot pull a SENSITIVE context into the cloud', () => {
    expect(routingPolicy({ ...base, privacyClass: 'SENSITIVE', requestedLocality: 'cloud-ok' }))
      .toEqual({ locality: 'local', cloudAllowed: false });
  });

  it('a caller cannot enable cloud for a RESTRICTED context even when cloud is allowed globally', () => {
    expect(routingPolicy({ ...base, privacyClass: 'RESTRICTED', requestedLocality: 'cloud-ok' }))
      .toEqual({ locality: 'local', cloudAllowed: false });
  });

  it('fails closed on a RESTRICTED context with no local model', () => {
    const decision = routingPolicy({ ...base, privacyClass: 'RESTRICTED', localModelAvailable: false });
    expect(decision).toHaveProperty('refuse');
    expect('refuse' in decision && decision.refuse).toContain('fail-closed');
  });

  it('still permits SENSITIVE work locally without a local model (it routes, then fails at the provider)', () => {
    // The refusal above is specific to RESTRICTED: SENSITIVE stays local but is not
    // refused here, so a missing local route surfaces as an ordinary routing failure
    // rather than a privacy violation.
    expect(routingPolicy({ ...base, privacyClass: 'SENSITIVE', localModelAvailable: false }))
      .toEqual({ locality: 'local', cloudAllowed: false });
  });

  it('a global cloud ban is never overridden by a caller preference', () => {
    expect(routingPolicy({ privacyClass: 'PUBLIC', requestedLocality: 'cloud-ok', cloudAllowed: false, localModelAvailable: true }))
      .toEqual({ locality: 'cloud-ok', cloudAllowed: false });
  });
});
