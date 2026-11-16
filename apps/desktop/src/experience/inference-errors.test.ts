import { describe, expect, it } from 'vitest';
import { inferenceFailureMessage } from './scene-client.ts';

/**
 * What the operator actually reads when inference fails. The Kernel classifies the failure;
 * the interface must not collapse six different causes into one unusable sentence — that is
 * what hid the real defect (NO_ROUTE on a private conversation with no local model).
 */
describe('inference failure messages', () => {
  it('explains a missing route in terms of the action available', () => {
    const message = inferenceFailureMessage('NO_ROUTE');
    expect(message).toMatch(/private conversation/i);
    expect(message).toMatch(/ALLOW CLOUD/);
    expect(message).not.toMatch(/UNKNOWN|undefined/);
  });

  it('distinguishes each authoritative code', () => {
    const codes = ['NO_ROUTE', 'AUTHENTICATION', 'RATE_LIMITED', 'TIMEOUT', 'UNAVAILABLE', 'BUDGET_EXCEEDED', 'PROVIDER_ERROR', 'INVALID_RESPONSE', 'CANCELLED'];
    const messages = codes.map(code => inferenceFailureMessage(code));
    expect(new Set(messages).size).toBe(codes.length);
    for (const message of messages) expect(message.length).toBeGreaterThan(20);
  });

  it('never leaks credentials, headers or payload details', () => {
    for (const code of ['AUTHENTICATION', 'PROVIDER_ERROR', 'INVALID_RESPONSE', undefined]) {
      const message = inferenceFailureMessage(code);
      expect(message).not.toMatch(/Bearer|sk-|authorization|payload|token=/i);
    }
  });

  it('falls back to a safe sentence when the code is unknown or missing', () => {
    expect(inferenceFailureMessage(undefined)).toMatch(/did not complete/i);
    expect(inferenceFailureMessage('SOMETHING_NEW')).toMatch(/did not complete/i);
  });
});
