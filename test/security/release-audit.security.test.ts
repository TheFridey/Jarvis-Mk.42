/**
 * MK.42 release-candidate audit probes.
 *
 * These are ATTACKS, written during the RC audit, kept as permanent regression
 * guards. Each one attempts something the constitution forbids and asserts the
 * system refuses. They exercise real production classes — no mocks of the
 * control under test.
 *
 * Covered here (no database required):
 *   A. forcing SENSITIVE / RESTRICTED context to a cloud model
 *   B. privacy labels surviving context compilation and ranking
 *   C. an agent stripping privacy / locality / cloud permission
 *   D. forged, malformed and mis-bound session credentials
 *
 * Database-backed probes (ATLAS epistemics ceiling, provenance rejection,
 * privacy deletion) live in apps/core/test/atlas-mnemosyne.integration.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { ModelRegistration, ModelRequest, ModelResponse, PrivacyClass } from '@jarvis/contracts';
import { ModelGatewayError } from '@jarvis/contracts';
import { ModelRegistry } from '../../apps/gateway/src/registry.ts';
import { ModelGateway } from '../../apps/gateway/src/gateway.ts';
import type { ProviderAdapter } from '../../apps/gateway/src/provider.ts';
import { maxPrivacyOf } from '../../apps/core/src/kernel/context/context-compiler.ts';
import { buildPackage } from '../../apps/core/src/kernel/context/ranking.ts';
import { AgentRuntime } from '../../apps/core/src/kernel/cognition/agent-runtime.ts';
import { SessionCredentialManager, type AccessCredentialStore } from '../../apps/core/src/kernel/identity/access-credentials.ts';
import { FakeClock } from '../../apps/core/src/runtime/clock.ts';
import type { SessionAccessCredential } from '@jarvis/contracts';

// --- fixtures ---------------------------------------------------------------
const adapter = (provider: string): ProviderAdapter => ({
  provider,
  async generate(request): Promise<ModelResponse> {
    return {
      modelId: 'x', output: { proposals: [] },
      usage: { contextUnits: 1, outputUnits: 1, costEstimate: 0, latencyMs: 1 }, finishReason: 'stop',
      provenance: { method: 'model', producedBy: provider, producedOn: 't', producedAt: '2026-09-01T00:00:00.000Z', correlationId: request.correlationId, derivedFromUntrusted: false },
    };
  },
});
const model = (id: string, locality: ModelRegistration['locality'], provider = id): ModelRegistration => ({
  id, provider, displayName: id, tasks: ['reason'], capabilities: ['json'],
  contextLimitUnits: 10_000, costPerContextUnit: 0, costPerOutputUnit: 0, locality, enabled: true,
  registeredAt: '2026-09-01T00:00:00.000Z',
});
const request = (over: Partial<ModelRequest> = {}): ModelRequest => ({
  task: 'reason', capabilities: ['json'],
  input: { instruction: 'x', context: {} as never, constraints: [] },
  budget: { contextUnits: 10, maxOutput: 10 },
  locality: 'any', correlationId: 'c', principalId: 'p', ...over,
});
const item = (privacyClass: PrivacyClass, id: string) => ({
  id, kind: 'world_fact' as const, summary: id, content: {}, privacyClass, relevance: 0.9,
  sizeUnits: 1, contentHash: id,
  provenance: { method: 'sensor' as const, producedBy: 't', producedOn: 'n', producedAt: '2026-09-01T00:00:00.000Z', correlationId: 'c', derivedFromUntrusted: false },
});

// ===========================================================================
describe('AUDIT A — forcing sensitive context to a cloud model', () => {
  it('refuses to route RESTRICTED context anywhere when only cloud models exist, even with locality:any and cloudAllowed:true', async () => {
    const registry = new ModelRegistry();
    registry.register(model('cloud-a', 'cloud-ok'), adapter('cloud-a'));
    registry.register(model('cloud-b', 'cloud-ok'), adapter('cloud-b'));
    // The attack: a caller that lies about locality/cloud permission.
    const attack = request({ privacyClass: 'RESTRICTED', locality: 'any', cloudAllowed: true });
    expect(registry.candidates(attack)).toEqual([]);
    await expect(new ModelGateway(registry).generate(attack)).rejects.toBeInstanceOf(ModelGatewayError);
    await expect(new ModelGateway(registry).generate(attack)).rejects.toMatchObject({ code: 'NO_ROUTE' });
  });

  it('routes SENSITIVE context to the local model and never the cloud one', async () => {
    const registry = new ModelRegistry();
    registry.register(model('cloud', 'cloud-ok'), adapter('cloud'));
    registry.register(model('local', 'local'), adapter('local'));
    for (const privacyClass of ['SENSITIVE', 'RESTRICTED'] as const) {
      const chosen = registry.candidates(request({ privacyClass, locality: 'any', cloudAllowed: true }));
      expect(chosen.map((c) => c.model.id)).toEqual(['local']);
    }
  });

  it('honours cloudAllowed:false independently of the privacy label', () => {
    const registry = new ModelRegistry();
    registry.register(model('cloud', 'cloud-ok'), adapter('cloud'));
    expect(registry.candidates(request({ cloudAllowed: false }))).toEqual([]);
    expect(registry.candidates(request({ locality: 'local' }))).toEqual([]);
  });

  it('DOCUMENTED FAIL-OPEN: an absent privacyClass is treated as INTERNAL and is cloud-eligible', () => {
    // Not a defect in the current wiring (the Kernel always stamps the class from
    // ContextPackage.maxPrivacyClass) but it is the one place a missing label
    // would not fail closed. Locked down by this test so a future change to the
    // default is deliberate. See the RC audit "privacy findings".
    const registry = new ModelRegistry();
    registry.register(model('cloud', 'cloud-ok'), adapter('cloud'));
    expect(registry.candidates(request({})).map((c) => c.model.id)).toEqual(['cloud']);
  });
});

// ===========================================================================
describe('AUDIT B — privacy labels survive compilation and ranking', () => {
  it('escalates the package privacy class to the most sensitive item present', () => {
    expect(maxPrivacyOf([])).toBe('PUBLIC');
    expect(maxPrivacyOf([item('PUBLIC', 'a'), item('INTERNAL', 'b')])).toBe('INTERNAL');
    expect(maxPrivacyOf([item('PUBLIC', 'a'), item('RESTRICTED', 'b'), item('INTERNAL', 'c')])).toBe('RESTRICTED');
    expect(maxPrivacyOf([item('SENSITIVE', 'a')])).toBe('SENSITIVE');
  });

  it('drops items above the requested ceiling instead of downgrading them', () => {
    const req = { correlationId: 'c', intent: 'i', intentClass: 'reason', budgetUnits: 1000, maxPrivacyClass: 'INTERNAL' as PrivacyClass };
    const result = buildPackage([item('INTERNAL', 'keep'), item('SENSITIVE', 'drop'), item('RESTRICTED', 'drop2')], req);
    expect(result.kept.map((k) => k.id)).toEqual(['keep']);
    expect(result.byPrivacy).toBe(2);
    // and nothing that was dropped reappears with a weakened label
    expect(result.kept.every((k) => k.privacyClass === 'INTERNAL')).toBe(true);
  });
});

// ===========================================================================
describe('AUDIT C — an agent cannot strip privacy, locality or cloud permission', () => {
  it('preserves privacyClass, locality and cloudAllowed through AgentRuntime into the gateway request', async () => {
    let seen: ModelRequest | undefined;
    const runtime = new AgentRuntime({
      async generate(r) {
        seen = r;
        return {
          modelId: 'local', output: { proposals: [{ proposalId: 'p', kind: 'answer', correlationId: r.correlationId, confidence: 1, provenance: { method: 'model', producedBy: 'm', producedOn: 'n', producedAt: '2026-09-01T00:00:00.000Z', correlationId: r.correlationId, derivedFromUntrusted: false }, text: 'ok', citations: [] }] },
          usage: { contextUnits: 1, outputUnits: 1, costEstimate: 0, latencyMs: 1 }, finishReason: 'stop',
          provenance: { method: 'model', producedBy: 'm', producedOn: 'n', producedAt: '2026-09-01T00:00:00.000Z', correlationId: r.correlationId, derivedFromUntrusted: false },
        } satisfies ModelResponse;
      },
    }, () => '2026-09-01T00:00:00.000Z');

    await runtime.invoke('agents.oracle', request({ privacyClass: 'RESTRICTED', locality: 'local', cloudAllowed: false }));
    expect(seen?.privacyClass).toBe('RESTRICTED');
    expect(seen?.locality).toBe('local');
    expect(seen?.cloudAllowed).toBe(false);
  });

  it('rejects a proposal kind outside the agent manifest scope', async () => {
    const runtime = new AgentRuntime({
      async generate(r) {
        return {
          modelId: 'local',
          // ORACLE may not emit capability_draft.
          output: { proposals: [{ proposalId: 'p', kind: 'capability_draft', correlationId: r.correlationId, confidence: 1, provenance: { method: 'model', producedBy: 'm', producedOn: 'n', producedAt: '2026-09-01T00:00:00.000Z', correlationId: r.correlationId, derivedFromUntrusted: false }, manifest: {}, adapterSource: '', testSource: '', researchNotes: '', declaredEgress: [] }] },
          usage: { contextUnits: 1, outputUnits: 1, costEstimate: 0, latencyMs: 1 }, finishReason: 'stop',
          provenance: { method: 'model', producedBy: 'm', producedOn: 'n', producedAt: '2026-09-01T00:00:00.000Z', correlationId: r.correlationId, derivedFromUntrusted: false },
        } satisfies ModelResponse;
      },
    }, () => '2026-09-01T00:00:00.000Z');
    await expect(runtime.invoke('agents.oracle', request())).rejects.toThrow(/outside agent scope/);
  });
});

// ===========================================================================
class CredStore implements AccessCredentialStore {
  rows = new Map<string, SessionAccessCredential & { secretHash: string }>();
  live = { sessionActive: true, identityActive: true, principalActive: true, nodeActive: true };
  async insert(r: SessionAccessCredential & { secretHash: string }) { this.rows.set(r.secretHash, r); }
  async find(h: string) { return this.rows.get(h) ?? null; }
  async revokeCredential(id: string, at: string) { for (const r of this.rows.values()) if (r.id === id) r.revokedAt = at; }
  async revokeSession(id: string, at: string) { for (const r of this.rows.values()) if (r.sessionId === id) r.revokedAt = at; }
  async revokeIdentity(id: string, at: string) { for (const r of this.rows.values()) if (r.identityId === id) r.revokedAt = at; }
  async revokeNode(id: string, at: string) { for (const r of this.rows.values()) if (r.nodeId === id) r.revokedAt = at; }
  async validity() { return this.live; }
}
let seq = 0;
const ids = { ulid: () => `cred-${++seq}` };
const issueInput = { identityId: 'identity', principalId: 'principal', sessionId: 'session', nodeId: 'node', scopes: ['desktop.read'], authStrength: 'strong' as const };

describe('AUDIT D — forged, malformed and mis-bound credentials', () => {
  const mk = () => new SessionCredentialManager({ store: new CredStore(), clock: new FakeClock(0), ids });

  it('rejects a forged bearer, a short bearer and a missing scheme', async () => {
    const m = mk();
    await m.issue(issueInput);
    const expected = { nodeId: 'node', scopes: [] as string[] };
    expect(await m.authenticate(undefined, expected)).toBeNull();
    expect(await m.authenticate('', expected)).toBeNull();
    expect(await m.authenticate('Basic abcdefghijklmnopqrstuvwxyz012345', expected)).toBeNull();
    expect(await m.authenticate('Bearer short', expected)).toBeNull();
    expect(await m.authenticate(`Bearer ${'f'.repeat(43)}`, expected)).toBeNull(); // right shape, wrong secret
  });

  it('rejects a token replayed from a different node or session, and one lacking a scope', async () => {
    const m = mk();
    const { accessToken } = await m.issue(issueInput);
    expect(await m.authenticate(`Bearer ${accessToken}`, { nodeId: 'node', sessionId: 'session', scopes: ['desktop.read'] })).not.toBeNull();
    expect(await m.authenticate(`Bearer ${accessToken}`, { nodeId: 'other-node', scopes: [] })).toBeNull();
    expect(await m.authenticate(`Bearer ${accessToken}`, { nodeId: 'node', sessionId: 'other-session', scopes: [] })).toBeNull();
    expect(await m.authenticate(`Bearer ${accessToken}`, { nodeId: 'node', scopes: ['desktop.write'] })).toBeNull();
    expect(await m.authenticate(`Bearer ${accessToken}`, { nodeId: '', scopes: [] })).toBeNull(); // absent node header fails closed
  });

  it('refuses to satisfy an approval-strength requirement with a weak or stale credential', async () => {
    const store = new CredStore();
    const clock = new FakeClock(0);
    const m = new SessionCredentialManager({ store, clock, ids, ttlMs: 60 * 60_000 });
    const weak = await m.issue({ ...issueInput, authStrength: 'single_factor' });
    expect(await m.authenticate(`Bearer ${weak.accessToken}`, { nodeId: 'node', scopes: [], minimumStrength: 'strong' })).toBeNull();

    const strong = await m.issue(issueInput);
    expect(await m.authenticate(`Bearer ${strong.accessToken}`, { nodeId: 'node', scopes: [], minimumStrength: 'strong', recentWithinMs: 5 * 60_000 })).not.toBeNull();
    clock.advance(6 * 60_000); // older than the approval freshness window
    expect(await m.authenticate(`Bearer ${strong.accessToken}`, { nodeId: 'node', scopes: [], minimumStrength: 'strong', recentWithinMs: 5 * 60_000 })).toBeNull();
  });

  it('stops accepting a token the moment its session, identity, principal or node stops being live', async () => {
    for (const key of ['sessionActive', 'identityActive', 'principalActive', 'nodeActive'] as const) {
      const store = new CredStore();
      const m = new SessionCredentialManager({ store, clock: new FakeClock(0), ids });
      const { accessToken } = await m.issue(issueInput);
      expect(await m.authenticate(`Bearer ${accessToken}`, { nodeId: 'node', scopes: [] })).not.toBeNull();
      store.live[key] = false;
      expect(await m.authenticate(`Bearer ${accessToken}`, { nodeId: 'node', scopes: [] })).toBeNull();
    }
  });

  it('invalidates the previous generation after rotation (no two live tokens)', async () => {
    const m = mk();
    const first = await m.issue(issueInput);
    const second = await m.rotate(`Bearer ${first.accessToken}`, { nodeId: 'node', sessionId: 'session', scopes: [] });
    expect(second?.credential.generation).toBe(2);
    expect(await m.authenticate(`Bearer ${first.accessToken}`, { nodeId: 'node', scopes: [] })).toBeNull();
    expect(await m.authenticate(`Bearer ${second!.accessToken}`, { nodeId: 'node', scopes: [] })).not.toBeNull();
  });
});
