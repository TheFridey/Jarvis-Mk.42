import { describe, expect, it } from 'vitest';
import type { Capability, PolicyQuery } from '@jarvis/contracts';
import { evaluatePolicy, BASE_RULE_PACK, checkResourceConstraints } from '@jarvis/permissions';
import { validateManifest } from '../../src/kernel/capability-registry/manifest-validate.ts';
import { CredentialBroker } from '../../src/kernel/credential-broker/broker.ts';
import { MemoryCredentialMaterialStore } from '../../src/kernel/credential-broker/material-store.ts';
import { advance } from '../../src/kernel/executor/lifecycle.ts';

const tokenConsumer = (invocationId: string) => ({
  async consume(value: string) {
    if (value !== 'authority') return undefined;
    return { token: value, invocationId, grantId: 'g', grantVersion: 1, scopes: [], mode: 'full' as const, issuedAt: '2026-09-03T12:00:00Z', expiresAt: '2099-01-01T00:00:00Z', principalId: 'p1' };
  },
});

const query = (): PolicyQuery => ({ actor: { kind: 'agent', id: 'hostile', onBehalfOf: 'p1', heldScopes: ['x'] }, action: { capabilityId: 'capabilities.test', action: 'write', riskClass: 'HIGH', requiredScopes: ['x'] }, context: { operatorReachable: true, degradation: 'nominal', derivedFromUntrusted: false, hostTrustTier: 'owned-secure', resourceRef: '/resource', originNodeId: 'node', authTrustLevel: 'verified', authMethod: 'passkey', jarvisMode: 'ENGAGED', recentDenialCount: 0, now: '2026-09-03T12:00:00Z' } });
const manifest = (): Capability => ({ id: 'capabilities.test', version: '1.0.0', description: 'test', provider: 'test', executionEnvironment: 'worker', auditPolicy: { hashInput: true, recordOutput: 'summary' }, privacyRequirements: { maxContentPrivacyClass: 'INTERNAL' }, requiredScopes: [], trustTierMin: 'owned-secure', actions: [{ name: 'read', inputSchema: {}, outputSchema: {}, riskClass: 'LOW', reversible: false, simulatable: false, verify: 'verify', idempotent: true, sideEffects: [], approvalPolicy: 'default', timeoutMs: 1000, verificationStrategy: { kind: 'world-read', adapterRef: 'verify' } }] });

describe('HEPHAESTUS structural security controls', () => {
  it('T16 prompt injection: untrusted provenance hard-caps HIGH', () => { const q = query(); q.context.derivedFromUntrusted = true; expect(evaluatePolicy(q, BASE_RULE_PACK).verdict).toBe('DENY'); });
  it('T17 tool injection: unknown policy paths cannot match', () => { const q = query(); expect(evaluatePolicy(q, [{ id: 'bad', version: 1, description: '', enabled: true, priority: 999, effect: 'ALLOW', predicate: { op: 'eq', path: '__proto__.authority', value: true } }]).verdict).toBe('DENY'); });
  it('T18 malicious web content cannot raise authority', () => { const q = query(); q.context.derivedFromUntrusted = true; q.context.llmRecommendation = 'ALLOW'; expect(evaluatePolicy(q, BASE_RULE_PACK).verdict).toBe('DENY'); });
  it('T20 confused deputy: missing on-behalf-of scope denies', () => { const q = query(); q.actor.heldScopes = []; expect(evaluatePolicy(q, BASE_RULE_PACK).firedRuleIds).toContain('hardcap.missing_scope'); });
  it('T21 replay: credential handles are single-use', async () => { const broker = new CredentialBroker(new MemoryCredentialMaterialStore({ test: 'secret-value' }), tokenConsumer('i')); const handle = await broker.mint({ authorityToken: 'authority', invocationId: 'i', capabilityId: 'capabilities.test', action: 'read', resourceRef: 'r', mode: 'full' }); broker.redeem(handle.handleId, 'i'); expect(() => broker.redeem(handle.handleId, 'i')).toThrow(/invalid|expired/); });
  it('T22 credential leakage: derived handles do not serialise secrets', async () => { const broker = new CredentialBroker(new MemoryCredentialMaterialStore({ github: 'secret-value' }), tokenConsumer('i')); const handle = await broker.mint({ authorityToken: 'authority', invocationId: 'i', capabilityId: 'capabilities.github', action: 'read', resourceRef: 'r', mode: 'full', kind: 'derived' }); expect(JSON.stringify(handle)).not.toContain('secret-value'); });
  it('fails closed when credential material is absent', async () => { const broker = new CredentialBroker(new MemoryCredentialMaterialStore({}), tokenConsumer('i')); await expect(broker.mint({ authorityToken: 'authority', invocationId: 'i', capabilityId: 'capabilities.test', action: 'read', resourceRef: 'r', mode: 'full' })).rejects.toThrow(/unavailable/); });
  it('rejects an authority token bound to another invocation', async () => { const broker = new CredentialBroker(new MemoryCredentialMaterialStore({ test: 'secret-value' }), tokenConsumer('other')); await expect(broker.mint({ authorityToken: 'authority', invocationId: 'i', capabilityId: 'capabilities.test', action: 'read', resourceRef: 'r', mode: 'full' })).rejects.toThrow(/authority token/); });
  it('T23 malicious extension: offensive manifests fail registration validation', () => { const m = manifest(); m.actions[0]!.sideEffects = ['port-scan a subnet']; expect(validateManifest(m)).toMatchObject({ ok: false }); });
  it('T24 command injection: command allowlist treats argv[0] as data', () => { expect(checkResourceConstraints([{ kind: 'command-allow', values: ['git'] }], { argv: ['sh', '-c', 'git status'] }, 'run').ok).toBe(false); });
  it('T25 cross-user access: resource constraints fail closed', () => { expect(checkResourceConstraints([{ kind: 'repo-allow', values: ['owner/a'] }], { repo: 'other/b' }, 'read').ok).toBe(false); });
  it('T26 unsafe rollback: reversible side effects require rollback strategy', () => { const m = manifest(); Object.assign(m.actions[0]!, { reversible: true, sideEffects: ['write'], rollback: undefined, rollbackStrategy: undefined }); expect(validateManifest(m)).toMatchObject({ ok: false }); });
  it('T28 action races: illegal lifecycle edges throw', () => { expect(() => advance('PROPOSED', 'EXECUTING')).toThrow(/illegal/); });
});
