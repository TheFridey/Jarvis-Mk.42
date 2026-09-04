import { describe, expect, it } from 'vitest';
import type { PolicyQuery } from '@jarvis/contracts';
import { BASE_RULE_PACK } from './base-pack.ts';
import { evaluatePolicy } from './evaluate.ts';
const query = (): PolicyQuery => ({ actor: { kind: 'agent', id: 'a1', onBehalfOf: 'p1', heldScopes: ['github.branch.write'] },
  action: { capabilityId: 'capabilities.github', action: 'create_branch', riskClass: 'MEDIUM', requiredScopes: ['github.branch.write'] },
  context: { operatorReachable: true, degradation: 'nominal', derivedFromUntrusted: false, hostTrustTier: 'owned-secure',
    resourceRef: 'octo/repo', originNodeId: 'srv', authTrustLevel: 'trusted', authMethod: 'token', jarvisMode: 'ENGAGED', recentDenialCount: 0, now: '2026-09-03T12:00:00Z' } });
describe('deterministic policy evaluation', () => {
  it('enforces non-overridable hard caps', () => {
    const q = query(); q.context.derivedFromUntrusted = true;
    expect(evaluatePolicy(q, BASE_RULE_PACK).firedRuleIds).toContain('hardcap.untrusted');
    const missing = query(); missing.actor.heldScopes = [];
    expect(evaluatePolicy(missing, BASE_RULE_PACK).verdict).toBe('DENY');
  });
  it('allows the scoped branch base rule and fails closed without it', () => {
    expect(evaluatePolicy(query(), BASE_RULE_PACK).verdict).toBe('ALLOW');
    expect(evaluatePolicy(query(), []).verdict).toBe('DENY');
  });
  it('is stable for cloned inputs', () => {
    for (let i = 0; i < 1000; i++) expect(evaluatePolicy(query(), BASE_RULE_PACK)).toEqual(evaluatePolicy(structuredClone(query()), BASE_RULE_PACK));
  });
});
