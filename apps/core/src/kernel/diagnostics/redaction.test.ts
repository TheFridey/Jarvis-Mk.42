import { describe, expect, it } from 'vitest';
import { redactFailure } from './http-server.ts';

/**
 * A length limit is not redaction. Provider errors and malformed input can echo credentials into a
 * failure message, so anything credential-shaped is replaced before it reaches a log line.
 */

describe('failure redaction', () => {
  it('removes an API key', () => {
    expect(redactFailure('upstream rejected key sk-live-abcdef1234567890')).not.toContain('sk-live');
  });

  it('removes a bearer token', () => {
    expect(redactFailure('401 for Bearer abc.def.ghi')).not.toContain('abc.def.ghi');
  });

  it('removes password and token assignments', () => {
    const text = redactFailure('connect failed password=hunter2 token: abc123');
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('abc123');
  });

  it('keeps an ordinary message readable', () => {
    expect(redactFailure('proposal correlation mismatch')).toBe('proposal correlation mismatch');
  });

  it('bounds the length', () => {
    expect(redactFailure('x'.repeat(1000)).length).toBeLessThanOrEqual(300);
  });
});
