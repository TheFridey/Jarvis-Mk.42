import { describe, expect, it } from 'vitest';
import {
  assistantConstraints, contractConstraints, IDENTITY_FORBIDDEN_TERMS, IDENTITY_VERSION,
  identityConstraints, registerFor, relationshipConstraints,
} from './assistant-identity.ts';

/**
 * One JARVIS, several registers.
 *
 * These assertions pin the things that must not drift: the identity is versioned, the register
 * is inferred from what was said rather than chosen by the owner, ordinary conversation never
 * inherits operational framing, and the authority contract is present in every register — a
 * casual remark can never become permission.
 */

const text = (...lists: string[][]) => lists.flat().join(' ').toLowerCase();

describe('identity profile', () => {
  it('is versioned, so a change of personality is a change of record', () => {
    expect(IDENTITY_VERSION).toBeGreaterThanOrEqual(2);
  });

  it('speaks British English and stays composed', () => {
    const identity = text(identityConstraints());
    expect(identity).toContain('british english');
    expect(identity).toContain('warm');
    expect(identity).toContain('honest');
  });

  it('carries no private, business or credential context', () => {
    const everything = text(identityConstraints(), relationshipConstraints());
    for (const term of IDENTITY_FORBIDDEN_TERMS) expect(everything).not.toContain(term);
  });

  it('keeps personal names out of tracked source', () => {
    const everything = text(identityConstraints(), relationshipConstraints());
    // No family names, no client names, no project codenames.
    for (const name of ['libby', 'luca', 'trev', 'aurora']) expect(everything).not.toContain(name);
  });

  it('forbids the register that made ordinary talk feel like a ticket', () => {
    const relationship = text(relationshipConstraints());
    expect(relationship).toContain('awaiting your instructions');
    expect(relationship).toContain('not a command prompt');
  });
});

describe('register inference', () => {
  it.each([
    ['Evening Jarvis.', 'COMPANION'],
    ['Girls on Film!', 'COMPANION'],
    ['Just having a laugh.', 'COMPANION'],
    ['Isn\'t it mad that you can turn rubber gloves into something that smells like grapes?', 'COMPANION'],
    ['Time for a hype session.', 'COMPANION'],
    ['We\'ve landed another client!', 'COMPANION'],
    ['All the prospects said no today.', 'COMPANION'],
    ['Business mode.', 'ADVISOR'],
    ['I reckon we could launch ten apps this month.', 'COMPANION'],
    ['How should we price the Shopify app?', 'ADVISOR'],
    ['The migration keeps timing out.', 'ADVISOR'],
    ['Audit the repository properly.', 'OPERATOR'],
    ['Restart the production server.', 'OPERATOR'],
    ['What\'s the status?', 'OPERATOR'],
    ['', 'COMPANION'],
  ])('%s → %s', (input, expected) => {
    expect(registerFor(input)).toBe(expected);
  });

  it('reads a transition mid-conversation without changing who is answering', () => {
    expect(registerFor('Anyway, business mode.')).toBe('ADVISOR');
    expect(registerFor('Let\'s get on with the TS migration')).toBe('ADVISOR');
    expect(registerFor('Can you run the migration?')).toBe('OPERATOR');
    // The same identity answers all three.
    const one = assistantConstraints('COMPANION').slice(0, 10).join(' ');
    const two = assistantConstraints('ADVISOR').slice(0, 10).join(' ');
    expect(one).toBe(two);
  });
});

describe('authority does not vary with tone', () => {
  it.each(['COMPANION', 'ADVISOR', 'OPERATOR'] as const)('%s keeps the authority contract', register => {
    const constraints = text(assistantConstraints(register));
    for (const line of contractConstraints()) expect(constraints).toContain(line.toLowerCase());
    expect(constraints).toContain('you propose, the kernel acts');
  });

  it('companion carries no operational framing', () => {
    const companion = text(assistantConstraints('COMPANION'));
    expect(companion).toContain('no task to infer');
    expect(companion).not.toContain('request to do something');
    expect(companion).not.toContain('working conversation');
  });

  it('operator speaks about doing, not about chatting', () => {
    const operator = text(assistantConstraints('OPERATOR'));
    expect(operator).toContain('request to do something');
    expect(operator).toContain('authority you do not have');
  });

  it('never tells the model it may decide its own permissions', () => {
    const everything = text(assistantConstraints('COMPANION'), assistantConstraints('OPERATOR'));
    expect(everything).not.toContain('you may decide');
    expect(everything).not.toContain('grant yourself');
  });
});
