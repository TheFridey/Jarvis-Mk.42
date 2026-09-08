/**
 * MK.46 — ATLAS + MNEMOSYNE become load-bearing (integration).
 *
 * Proves the two mandated end-to-end paths against real Postgres:
 *   A. conversation/event -> memory candidate -> consolidation -> persisted
 *      episode -> Context Compiler retrieval -> cognition receives it
 *   B. observation -> ATLAS candidate -> fact -> temporal query -> context ->
 *      cognition
 * plus contradiction preservation, fact supersession + history, restart
 * persistence, and privacy-aware cognition routing (never silently to cloud).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModelRequest, ModelResponse, Provenance } from '@jarvis/contracts';
import { isDockerAvailable } from '@jarvis/testkit';
import type { ModelGatewayPort } from '../src/kernel/cognition/model-client.ts';
import { buildKernel } from '../src/kernel/lifecycle/kernel.ts';
import { loadConfig } from '../src/runtime/config.ts';
import { setupIt, truncateAll, type ItContext } from './it-harness.ts';

const dockerOk = await isDockerAvailable();
const principalId = 'principal-operator';
const prov = (correlationId: string): Provenance => ({
  method: 'assertion', producedBy: principalId, producedOn: 'local-server',
  producedAt: '2026-09-01T00:00:00.000Z', correlationId, derivedFromUntrusted: false,
});

class CapturingGateway implements ModelGatewayPort {
  lastRequest: ModelRequest | undefined;
  async generate(r: ModelRequest): Promise<ModelResponse> {
    this.lastRequest = r;
    return {
      modelId: r.locality === 'local' ? 'fake-local' : 'fake-any',
      output: { proposals: [{
        proposalId: `p-${r.correlationId}`, kind: 'answer', correlationId: r.correlationId, confidence: 1,
        provenance: { method: 'model', producedBy: 'fake', producedOn: 'test', producedAt: '2026-09-01T00:00:00.000Z', correlationId: r.correlationId, derivedFromUntrusted: false },
        text: 'ack', citations: [],
      }] },
      usage: { contextUnits: 10, outputUnits: 5, costEstimate: 0, latencyMs: 1 },
      finishReason: 'stop',
      provenance: { method: 'model', producedBy: 'fake', producedOn: 'test', producedAt: '2026-09-01T00:00:00.000Z', correlationId: r.correlationId, derivedFromUntrusted: false },
    };
  }
  async health() { return [{ modelId: 'fake-local', provider: 'fake', status: 'healthy' as const, checkedAt: '2026-09-01T00:00:00.000Z' }]; }
}

async function entityId(ctx: ItContext, name: string): Promise<string> {
  const [r] = await ctx.pg.sql<{ id: string }[]>`select id from atlas.entities where canonical_name = ${name} limit 1`;
  return r!.id;
}

describe.skipIf(!dockerOk)('ATLAS + MNEMOSYNE load-bearing (integration)', () => {
  let ctx: ItContext;
  let gateway: CapturingGateway;

  beforeAll(async () => {
    ctx = await setupIt();
    await truncateAll(ctx.pg);
    ctx.clock.set(Date.parse('2026-09-20T12:00:00.000Z'));
    gateway = new CapturingGateway();
  }, 240_000);
  afterAll(() => ctx?.cleanup());

  it('PATH A: event/experience -> candidate -> consolidation -> episode -> context -> cognition', async () => {
    const k = ctx.makeKernel({ modelGateway: gateway });
    await k.start();

    // an experience worth remembering (enters the candidate pipeline, must pass the scorer gate)
    const ingest = await k.knowledge.ingest({
      kind: 'episode', correlationId: 'exp-1', principalId, provenance: prov('exp-1'),
      episode: {
        kind: 'decision', title: 'Chose PostgreSQL for ScaleSmiths analytics',
        summary: 'Decided to use PostgreSQL for the ScaleSmiths analytics service because pgvector covers similarity search without a second datastore',
        occurredFrom: '2026-09-01T09:00:00.000Z', occurredTo: '2026-09-01T09:05:00.000Z',
        participantsRefs: [], sourceEventIds: ['evt-decision-1'], salienceHint: 0.8,
      },
    });
    expect(ingest.mnemosyneCandidateId).toBeDefined();
    expect(ingest.routed.targets).toEqual(['mnemosyne']);

    // DREAMING scores the candidate and, if durable+valuable, promotes it to an episode
    const run = await k.consolidateMemory();
    expect(run.proposalsEmitted).toBeGreaterThan(0);
    const [episode] = await ctx.pg.sql<{ id: string; summary: string }[]>`select id, summary from mnemosyne.episodes`;
    expect(episode?.summary).toMatch(/PostgreSQL/);
    const [cand] = await ctx.pg.sql<{ disposition: string; score_breakdown: unknown }[]>`select disposition, score_breakdown from mnemosyne.candidates`;
    expect(cand?.disposition).toBe('accepted');
    expect(cand?.score_breakdown).toBeTruthy(); // "why do you remember that?"

    // recall finds it by meaning, not just keyword
    const recalled = await k.memory.recall({ text: 'which database for ScaleSmiths analytics', principalId, k: 5, floor: 0.1 });
    expect(recalled.items.some((x) => x.class === 'episodic' && /PostgreSQL/i.test((x.item as { summary: string }).summary))).toBe(true);
    expect(recalled.weightsUsed.sim).toBeLessThanOrEqual(0.35); // similarity weight stays bounded

    // Context Compiler fuses it into the package
    const pkg = await k.context.compile({
      correlationId: 'ctx-1', intent: 'ScaleSmiths analytics database choice', intentClass: 'reason',
      budgetUnits: 4000, maxPrivacyClass: 'RESTRICTED',
    });
    expect(pkg.items.some((x) => x.kind === 'episodic_memory')).toBe(true);
    expect(pkg.freshness?.memoryAsOf).toBeTruthy();

    // cognition actually receives the memory in its context
    await k.cognition.submit({ requestId: 'q-A', principalId, correlationId: 'corr-A', input: 'What database did we choose for ScaleSmiths analytics?', agentId: 'agents.oracle', task: 'reason' });
    const ctxPkg = gateway.lastRequest!.input.context as { items: Array<{ kind: string }> };
    expect(ctxPkg.items.some((x) => x.kind === 'episodic_memory')).toBe(true);
  });

  it('PATH B: observation -> promotion -> fact -> temporal query -> context', async () => {
    await truncateAll(ctx.pg);
    const k = ctx.makeKernel({ modelGateway: gateway });
    await k.start();

    for (let i = 1; i <= 3; i++) {
      await k.knowledge.ingest({
        kind: 'perception_observation', correlationId: `obs-${i}`, principalId, provenance: prov(`obs-${i}`),
        observation: {
          eventId: `evt-obs-${i}`, kind: 'principal-operator/at_workstation', summary: 'true',
          source: 'vision-gateway', node: 'local-server', observedAt: '2026-09-15T10:00:00.000Z',
          confidence: 0.8, expiresAt: '2026-12-01T00:00:00.000Z',
        },
      });
    }
    // observations are NOT facts yet
    const preFacts = await ctx.pg.sql`select 1 from atlas.facts`;
    expect(preFacts).toHaveLength(0);

    const harvest = await k.harvestKnowledge();
    expect(harvest.promotedFacts).toBe(1);

    const id = await entityId(ctx, 'principal-operator');
    const believed = await k.atlas.currentlyBelieved(id, 'at_workstation');
    expect(believed.known).toBe(true);
    if (believed.known) {
      expect(believed.value.facts[0]?.value).toBe('true');
      expect(believed.value.facts[0]?.epistemicStatus).toBe('observed'); // an observation-derived fact, not an assertion
    }
    // "what evidence supports this?"
    const ev = await k.atlas.evidenceFor(believed.known ? believed.value.facts[0]!.id : '');
    expect(ev.evidence.length).toBeGreaterThanOrEqual(3);

    // temporal query answers "what changed today?"
    const changed = await k.atlas.changedBetween('2026-09-14T00:00:00.000Z', '2026-09-16T00:00:00.000Z', { entityId: id });
    expect(changed.changes.some((c) => c.attribute === 'at_workstation' && c.changeKind === 'asserted')).toBe(true);

    const pkg = await k.context.compile({
      correlationId: 'ctx-B', intent: 'is the operator at their workstation', intentClass: 'reason',
      budgetUnits: 4000, maxPrivacyClass: 'RESTRICTED',
    });
    expect(pkg.items.some((x) => x.kind === 'world_fact')).toBe(true);
    expect(pkg.freshness?.atlasAsOf).toBeTruthy();
  });

  it('records a contradiction instead of overwriting, then a principal assertion resolves it', async () => {
    await truncateAll(ctx.pg);
    const k = ctx.makeKernel({ modelGateway: gateway });
    await k.start();

    const mkFact = (value: string, corr: string) => k.knowledge.ingest({
      kind: 'extracted_fact', correlationId: corr, principalId,
      provenance: { method: 'sensor', producedBy: 'perception', producedOn: 'local-server', producedAt: '2026-09-01T00:00:00.000Z', correlationId: corr, derivedFromUntrusted: false },
      fact: { subjectRef: 'Rhys', attribute: 'role', value, epistemicStatus: 'observed', confidence: 0.7, validFrom: '2026-09-10T12:00:00.000Z', evidenceRefs: [corr] },
    });
    await mkFact('engineer', 'c-role-1');
    const conflictResult = await mkFact('founder', 'c-role-2');
    expect(conflictResult.conflictId).toBeDefined();

    const rid = await entityId(ctx, 'Rhys');
    const both = await k.atlas.currentlyBelieved(rid, 'role');
    expect(both.known && both.value.facts).toHaveLength(2); // BOTH claims retained
    const openConflicts = await ctx.pg.sql`select 1 from atlas.conflicts where status = 'open'`;
    expect(openConflicts).toHaveLength(1);

    // JARVIS can say "I have conflicting information": it shows up in context
    const pkg = await k.context.compile({ correlationId: 'ctx-c', intent: "what is Rhys's role", intentClass: 'reason', budgetUnits: 4000, maxPrivacyClass: 'RESTRICTED' });
    expect(pkg.items.some((x) => x.kind === 'world_conflict')).toBe(true);

    // a principal correction resolves it
    await k.knowledge.ingest({
      kind: 'principal_assertion', correlationId: 'c-role-3', principalId, provenance: prov('c-role-3'),
      fact: { subjectRef: 'Rhys', attribute: 'role', value: 'founder', epistemicStatus: 'asserted', confidence: 1, validFrom: '2026-09-18T00:00:00.000Z', evidenceRefs: ['operator-said-so'] },
    });
    const resolved = await ctx.pg.sql`select 1 from atlas.conflicts where status = 'resolved_by_principal'`;
    expect(resolved).toHaveLength(1);
    const after = await k.atlas.currentlyBelieved(rid, 'role');
    expect(after.known && after.value.facts.every((f) => f.value === 'founder')).toBe(true);
  });

  it('supersedes a weaker belief and keeps the full history chain across a restart', async () => {
    await truncateAll(ctx.pg);
    const k = ctx.makeKernel({ modelGateway: gateway });
    await k.start();

    await k.knowledge.ingest({
      kind: 'extracted_fact', correlationId: 'h1', principalId,
      provenance: { method: 'inference', producedBy: 'cognition', producedOn: 'local-server', producedAt: '2026-09-01T00:00:00.000Z', correlationId: 'h1', derivedFromUntrusted: false },
      fact: { subjectRef: 'Office Server', attribute: 'status', value: 'unknown', epistemicStatus: 'inferred', confidence: 0.4, validFrom: '2026-09-10T00:00:00.000Z', evidenceRefs: ['h1'] },
    });
    await k.knowledge.ingest({
      kind: 'extracted_fact', correlationId: 'h2', principalId,
      provenance: { method: 'sensor', producedBy: 'telemetry', producedOn: 'local-server', producedAt: '2026-09-02T00:00:00.000Z', correlationId: 'h2', derivedFromUntrusted: false },
      fact: { subjectRef: 'Office Server', attribute: 'status', value: 'online', epistemicStatus: 'observed', confidence: 0.9, validFrom: '2026-09-15T00:00:00.000Z', evidenceRefs: ['h2'] },
    });

    const sid = await entityId(ctx, 'Office Server');
    const now = await k.atlas.currentlyBelieved(sid, 'status');
    expect(now.known && now.value.facts.map((f) => f.value)).toEqual(['online']);

    const history = await k.atlas.history(sid, 'status');
    expect(history.chain.map((h) => h.fact.value)).toEqual(['unknown', 'online']);
    expect(history.chain[0]?.supersededByFactId).toBe(history.chain[1]?.fact.id);

    const wasBefore = await k.atlas.believedAt(sid, 'status', '2026-09-12T00:00:00.000Z');
    expect(wasBefore.known && wasBefore.value.facts.map((f) => f.value)).toEqual(['unknown']);

    // restart: a fresh Kernel over the same database still believes it
    const k2 = ctx.makeKernel({ modelGateway: gateway });
    await k2.start();
    const survived = await k2.atlas.currentlyBelieved(sid, 'status');
    expect(survived.known && survived.value.facts.map((f) => f.value)).toEqual(['online']);
    const survivedHistory = await k2.atlas.history(sid, 'status');
    expect(survivedHistory.chain).toHaveLength(2);
  });

  it('routes SENSITIVE context to a local model, never cloud; fails closed with no local route', async () => {
    await truncateAll(ctx.pg);
    const k = ctx.makeKernel({ modelGateway: gateway });
    await k.start();

    await k.knowledge.ingest({
      kind: 'principal_assertion', correlationId: 'sec-1', principalId, provenance: prov('sec-1'),
      privacyHint: 'RESTRICTED',
      fact: { subjectRef: 'Aurora Project', attribute: 'codename', value: 'AURORA', epistemicStatus: 'asserted', confidence: 1, validFrom: '2026-09-10T00:00:00.000Z', evidenceRefs: ['operator'] },
    });

    await k.cognition.submit({ requestId: 'q-sec', principalId, correlationId: 'corr-sec', input: 'what is the Aurora Project codename', agentId: 'agents.oracle', task: 'reason' });
    expect(gateway.lastRequest!.input.context).toMatchObject({ maxPrivacyClass: 'RESTRICTED' });
    expect(gateway.lastRequest!.locality).toBe('local');
    expect(gateway.lastRequest!.cloudAllowed).toBe(false);
    expect(gateway.lastRequest!.privacyClass).toBe('RESTRICTED'); // label never stripped

    // with no policy-permitted local route, the same request fails closed
    const noRoute = buildKernel(
      loadConfig({ dbUrl: ctx.container.url, natsEnabled: false, telemetryDisabled: true, redisUrl: '', diagnosticsPort: 0, modeMinDwellMs: 1, modelLocalRouteAvailable: false }),
      { pg: ctx.pg, clock: ctx.clock, forceInProcessBus: true, noHttp: true, noScheduler: true, modelGateway: gateway },
    );
    await noRoute.start();
    await expect(
      noRoute.cognition.submit({ requestId: 'q-sec-2', principalId, correlationId: 'corr-sec-2', input: 'what is the Aurora Project codename', agentId: 'agents.oracle', task: 'reason' }),
    ).rejects.toThrow(/RESTRICTED|fail-closed/);
    await noRoute.stop();
  });

  it('agents may query and propose, but never write authoritative records directly', async () => {
    await truncateAll(ctx.pg);
    const k = ctx.makeKernel({ modelGateway: gateway });
    await k.start();

    // an agent proposes a fact — it is downgraded and routed through the mediator
    const proposed = await k.knowledgeFacade.propose({
      kind: 'atlas', principalId, correlationId: 'agent-1', subjectRef: 'ScaleSmiths',
      attribute: 'stack', value: 'node+postgres', epistemicStatus: 'observed', confidence: 0.99,
      evidenceRefs: ['scout-web-1'],
    });
    expect(proposed.accepted).toBe(true);
    const [row] = await ctx.pg.sql<{ epistemic_status: string; confidence: number }[]>`select epistemic_status, confidence from atlas.facts where attribute = 'stack'`;
    expect(row?.epistemic_status).toBe('inferred'); // capped: an agent cannot assert 'observed'
    expect(Number(row?.confidence)).toBeLessThanOrEqual(0.85); // confidence capped

    // an agent proposal with no evidence is rejected
    const bad = await k.knowledgeFacade.propose({
      kind: 'atlas', principalId, correlationId: 'agent-2', subjectRef: 'ScaleSmiths',
      attribute: 'revenue', value: 1_000_000, epistemicStatus: 'inferred', confidence: 0.5, evidenceRefs: [],
    });
    expect(bad.accepted).toBe(false);

    // an agent can query knowledge back
    const q = await k.knowledgeFacade.query({ principalId, text: 'ScaleSmiths stack', k: 5 });
    expect(q.facts.some((f) => f.attribute === 'stack')).toBe(true);
  });
});
