import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Capability, CapabilityInvocationProposal, Grant } from '@jarvis/contracts';
import { isDockerAvailable } from '@jarvis/testkit';
import filesystem from '../../../capabilities/filesystem/definition.ts';
import liar from './fixtures/lying-filesystem-capability.ts';
import { setupIt, truncateAll, type ItContext } from './it-harness.ts';

const dockerOk = await isDockerAvailable();
const principalId = 'principal-operator';
const moduleUrl = (path: string) => pathToFileURL(resolve(path)).href;
const proposal = (id: string, capabilityId: string, version: string, action: string, input: unknown): CapabilityInvocationProposal => ({ proposalId: id, kind: 'capability_invocation', correlationId: `corr-${id}`, confidence: 1, provenance: { method: 'assertion', producedBy: 'integration-test', producedOn: 'local-server', producedAt: '2026-09-01T00:00:00.000Z', correlationId: `corr-${id}`, derivedFromUntrusted: false }, invocation: { capabilityId, capabilityVersion: version, action, input }, justification: id });

describe.skipIf(!dockerOk)('load-bearing agency pipeline (integration)', () => {
  let ctx: ItContext; let root: string;
  beforeAll(async () => {
    ctx = await setupIt(); await truncateAll(ctx.pg); root = await mkdtemp(join(tmpdir(), 'jarvis-agency-'));
  }, 120_000);
  afterAll(async () => { await ctx?.cleanup(); if (root) await rm(root, { recursive: true, force: true }); });

  it('composes registration, policy, permission, isolated execution, verification, and durable lifecycle audit', async () => {
    const deniedManifest: Capability = { ...filesystem.manifest, version: '1.0.1', actions: [...filesystem.manifest.actions, { ...filesystem.manifest.actions[1]!, name: 'write_outside_workspace' }] };
    const approvalManifest: Capability = { ...filesystem.manifest, id: 'capabilities.terminal', version: '1.0.0', actions: [{ ...filesystem.manifest.actions[1]!, name: 'write_file', riskClass: 'HIGH', simulatable: false }] };
    const credentialManifest: Capability = { ...filesystem.manifest, id: 'capabilities.credential_test', version: '1.0.0', credentialKind: 'wrapped-static', requiredScopes: [], actions: [{ ...filesystem.manifest.actions[0]!, name: 'read', riskClass: 'AMBIENT' }] };
    const grant: Grant = { id: 'grant-agency-it', principalId, holder: { kind: 'principal', id: principalId }, scopes: ['filesystem.read', 'filesystem.write'], maxRiskWithoutLiveApproval: 'MEDIUM', mayProceedWithoutLiveApproval: true, issuedAt: '2026-09-01T00:00:00.000Z', version: 1, resourceConstraints: [{ kind: 'path-prefix', value: root }], nodeConstraints: [], timeWindows: [] };
    const k = ctx.makeKernel({ capabilities: [
      { manifest: deniedManifest, moduleUrl: moduleUrl('capabilities/filesystem/definition.ts') },
      { manifest: approvalManifest, moduleUrl: moduleUrl('capabilities/filesystem/definition.ts') },
      { manifest: credentialManifest, moduleUrl: moduleUrl('capabilities/filesystem/definition.ts') },
      { manifest: liar.manifest, moduleUrl: moduleUrl('apps/core/test/fixtures/lying-filesystem-capability.ts') },
    ], bootstrapGrants: [grant] });
    await k.start();

    const unregistered = await k.agency.submit(proposal('unregistered', 'capabilities.missing', '1.0.0', 'run', {}), { principalId, authenticated: true });
    expect(unregistered.outcome).toBe('rejected');

    const denied = await k.agency.submit(proposal('denied', deniedManifest.id, deniedManifest.version, 'write_outside_workspace', { root, path: join(root, 'denied.txt'), content: 'no' }), { principalId, authenticated: true });
    expect(denied.outcome).toBe('denied');
    await expect(readFile(join(root, 'denied.txt'), 'utf8')).rejects.toThrow();

    const noGrant = await k.agency.submit(proposal('no-grant', liar.manifest.id, liar.manifest.version, 'write', { root, path: join(root, 'none.txt'), content: 'no' }), { principalId: 'principal-without-grant', authenticated: true });
    expect(noGrant.outcome).toBe('denied');

    const approvalProposal = proposal('approval', approvalManifest.id, approvalManifest.version, 'write_file', { root, path: join(root, 'approval.txt'), content: 'approved' });
    await writeFile(join(root, 'approval.txt'), 'before');
    const approval = await k.agency.submit(approvalProposal, { principalId, authenticated: true });
    expect(approval.outcome).toBe('awaiting_approval');
    expect(await k.approvals.approve({ invocationId: approval.invocationId, operatorId: principalId, sessionId: 'agency-it', authTrustLevel: 'trusted' })).toBe(true);
    const approved = await k.agency.submit(approvalProposal, { principalId, authenticated: true });
    const approvalEvents = await k.eventStore.byCorrelation('corr-approval');
    expect(approved.outcome, JSON.stringify(approvalEvents.map((event) => ({ type: event.type, payload: event.payload })))).toBe('verified');
    expect(await readFile(join(root, 'approval.txt'), 'utf8')).toBe('approved');

    const expiredProposal = proposal('expired-approval', approvalManifest.id, approvalManifest.version, 'write_file', { root, path: join(root, 'expired.txt'), content: 'no' });
    const expired = await k.agency.submit(expiredProposal, { principalId, authenticated: true });
    expect(expired.outcome).toBe('awaiting_approval');
    ctx.clock.advance(16 * 60_000);
    expect((await k.approvals.forInvocation(expired.invocationId))?.state).toBe('expired');
    expect((await k.agency.submit(expiredProposal, { principalId, authenticated: true })).outcome).toBe('denied');
    await expect(readFile(join(root, 'expired.txt'), 'utf8')).rejects.toThrow();

    const credential = await k.agency.submit(proposal('credential', credentialManifest.id, credentialManifest.version, 'read', { root, path: join(root, 'seed.txt') }), { principalId, authenticated: true });
    expect(credential.outcome).toBe('denied');

    await writeFile(join(root, 'liar.txt'), 'before');
    const verification = await k.agency.submit(proposal('verify-failure', liar.manifest.id, liar.manifest.version, 'write', { root, path: join(root, 'liar.txt'), content: 'claimed' }), { principalId, authenticated: true });
    expect(verification.outcome).toBe('verification_failed');
    expect(await readFile(join(root, 'liar.txt'), 'utf8')).toBe('before');

    await writeFile(join(root, 'rollback.txt'), 'before');
    const rolledBack = await k.agency.submit(proposal('rollback', liar.manifest.id, liar.manifest.version, 'reversible_lie', { root, path: join(root, 'rollback.txt'), content: 'claimed' }), { principalId, authenticated: true });
    expect(rolledBack.outcome).toBe('rolled_back');
    expect(await readFile(join(root, 'rollback.txt'), 'utf8')).toBe('before');

    await writeFile(join(root, 'ok.txt'), 'before');
    const success = await k.agency.submit(proposal('success', deniedManifest.id, deniedManifest.version, 'write_file', { root, path: join(root, 'ok.txt'), content: 'after' }), { principalId, authenticated: true });
    expect(success.outcome).toBe('verified');
    expect(await readFile(join(root, 'ok.txt'), 'utf8')).toBe('after');
    const events = await k.eventStore.byCorrelation('corr-success');
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(['jarvis.agency.invocation.proposed', 'jarvis.agency.invocation.policy_checked', 'jarvis.agency.invocation.started', 'jarvis.agency.invocation.verified']));
    expect(events.every((event) => event.source.component === 'capability-executor')).toBe(true);
    const row = await ctx.pg.sql<{ state: string }[]>`select state from agency.invocations where invocation_id=${success.invocationId}`;
    expect(row[0]?.state).toBe('COMPLETED');
  }, 60_000);
});
