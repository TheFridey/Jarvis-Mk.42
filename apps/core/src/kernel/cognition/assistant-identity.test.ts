import { describe, expect, it } from 'vitest';
import {
  assistantConstraints,
  ASSISTANT_NAME,
  contractConstraints,
  IDENTITY_FORBIDDEN_TERMS,
  identityConstraints,
} from './assistant-identity.ts';

/**
 * Prompt construction for the portfolio of things the model is told. These are cheap tests
 * with a specific job: keep the assistant concise without ever letting the style layer and
 * the authority layer merge, and keep private context out of the prompt entirely.
 */
describe('assistant identity', () => {
  const constraints = assistantConstraints();
  const prompt = constraints.join(' ');

  it('names the assistant and sets a concise default', () => {
    expect(prompt).toContain(ASSISTANT_NAME);
    expect(prompt).toMatch(/concise/i);
    expect(prompt).toMatch(/two sentences/i);
  });

  it('forbids reciting limitations during ordinary conversation', () => {
    expect(prompt).toMatch(/do not recite your limitations/i);
  });

  it('keeps the authority rule: proposals only, never claims of execution', () => {
    expect(prompt).toMatch(/never claim to have executed/i);
    expect(prompt).toMatch(/the kernel acts/i);
  });

  it('keeps the JSON output contract', () => {
    expect(prompt).toMatch(/proposals array/i);
    expect(prompt).toMatch(/correlationId/);
  });

  it('carries no private, business or credential context', () => {
    const lowered = prompt.toLowerCase();
    for (const term of IDENTITY_FORBIDDEN_TERMS) expect(lowered).not.toContain(term);
  });

  it('is stable and free of interpolated state', () => {
    // Same output every call: identity must not vary with conversation, principal or mode.
    expect(identityConstraints()).toEqual(identityConstraints());
    expect(contractConstraints()).toEqual(contractConstraints());
    expect(prompt).not.toMatch(/\d{4}-\d{2}-\d{2}/); // no timestamps
    expect(prompt).not.toMatch(/principal-|conv-|0000/); // no identifiers
  });

  it('does not invite the model to conceal failures', () => {
    expect(prompt).not.toMatch(/conceal|hide the error|pretend/i);
    expect(prompt).toMatch(/honest/i);
  });
});
