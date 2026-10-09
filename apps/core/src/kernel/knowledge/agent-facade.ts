import { randomUUID } from 'node:crypto';
import type { DomainService } from '../domains/domain-service.ts';
import { currentDomainScope } from '../domains/scope.ts';
/**
 * `KnowledgeAgentFacade` — the ONLY way ORACLE / SCOUT / FORGE touch ATLAS and
 * MNEMOSYNE (contract: knowledge-agent.ts, ADR-0020 §Agent integration).
 *
 * Agents MAY query and MAY propose. They MAY NOT mutate authoritative records:
 * every proposed write is downgraded (`derivedFromUntrusted = true`, epistemic
 * status capped, causal ladder capped) and routed through the Knowledge
 * Ingestion mediator, which validates and decides supersession/conflict. The
 * agent never sees an `AtlasStore` / `MnemosyneStore`.
 */
import type {
  AtlasProposal,
  KnowledgeAgentFacade as KnowledgeAgentFacadePort,
  KnowledgeProposal,
  KnowledgeProposalResult,
  KnowledgeQuery,
  KnowledgeQueryResult,
  MemoryProposal,
  Ulid,
} from '@jarvis/contracts';
import type { EpistemicStatus } from '@jarvis/contracts';
import type { Clock } from '../../runtime/clock.ts';
import type { AtlasQueryService } from '../atlas/atlas-query.ts';
import type { AtlasStore } from '../atlas/stores.ts';
import type { EntityResolver } from '../atlas/entity-resolver.ts';
import type { MemoryRecallService } from '../mnemosyne/recall.ts';
import type { KnowledgeIngestion } from './knowledge-ingestion.ts';

const MAX_K = 12;

/** Agents cannot claim direct observation or principal authority. */
function capEpistemicStatus(requested: EpistemicStatus): EpistemicStatus {
  return requested === 'derived' || requested === 'predicted' ? requested : 'inferred';
}

export class KnowledgeAgentFacade implements KnowledgeAgentFacadePort {
  constructor(
    private readonly d: {
      domains?:DomainService; atlasQuery: AtlasQueryService;
      atlasStore: AtlasStore;
      recall: MemoryRecallService;
      ingestion: KnowledgeIngestion;
      resolver: EntityResolver;
      clock: Clock;
    },
  ) {}

  async query(q: KnowledgeQuery): Promise<KnowledgeQueryResult> {
    if(this.d.domains&&!currentDomainScope())return this.d.domains.run(q.principalId,q,'knowledge-query:'+randomUUID(),()=>this.query(q));
    const scope=currentDomainScope();if(scope&&(scope.principalId!==q.principalId||(q.domainId&&q.domainId!==scope.domainId)))throw new Error('knowledge query ownership mismatch');
    const k = Math.min(Math.max(1, q.k), MAX_K);
    const entityIds = [...(q.entityIds ?? [])];
    // read-only entity search from the free text if the caller gave none
    // (never creates — an agent query must not mutate ATLAS)
    if (entityIds.length === 0 && q.text.trim()) {
      const found = await this.d.atlasStore.searchEntities(q.principalId, q.text, 4).catch(() => []);
      entityIds.push(...found.map((e) => e.id));
    }

    const facts: KnowledgeQueryResult['facts'] = [];
    const relationships: KnowledgeQueryResult['relationships'] = [];
    const unknowns: string[] = [];
    for (const eid of entityIds.slice(0, 4)) {
      const believed = await this.d.atlasQuery.currentlyBelieved(eid);
      if (believed.known) facts.push(...believed.value.facts.slice(0, k));
      else unknowns.push(`no active facts for entity ${eid}`);
      const rels = await this.d.atlasQuery.relationships(eid, { at: q.asOf ?? this.d.clock.nowIso() });
      relationships.push(...rels.relationships.slice(0, k));
    }

    const recalled = await this.d.recall.recall({
      text: q.text, principalId: q.principalId, entityIds,
      ...(q.objectiveIds ? { objectiveIds: q.objectiveIds } : {}),
      k, floor: 0.25, ...(q.asOf ? { asOf: q.asOf } : {}),
    });

    return { facts: facts.slice(0, k), relationships: relationships.slice(0, k), memories: recalled.items, unknowns };
  }

  async explain(factId: Ulid, principalId: string): Promise<KnowledgeQueryResult> {
    if(this.d.domains&&!currentDomainScope())return this.d.domains.run(principalId,{},'knowledge-explain:'+randomUUID(),()=>this.explain(factId,principalId));
    if(currentDomainScope()&&currentDomainScope()!.principalId!==principalId)throw new Error('knowledge explanation ownership mismatch');
    const fact=await this.d.atlasStore.getFact(factId);
    if(!fact||fact.principalId!==principalId)return {facts:[],relationships:[],memories:[],evidence:[],unknowns:['no authorised evidence']};
    const { evidence } = await this.d.atlasQuery.evidenceFor(factId);
    return { facts: [], relationships: [], memories: [], evidence, unknowns: evidence.length === 0 ? [`no evidence recorded for fact ${factId}`] : [] };
  }

  async propose(p: KnowledgeProposal): Promise<KnowledgeProposalResult> {
    if(this.d.domains&&!currentDomainScope())return this.d.domains.run(p.principalId,await this.d.domains.bound(p.principalId,p.correlationId),p.correlationId,()=>this.propose(p));
    if(currentDomainScope()&&currentDomainScope()!.principalId!==p.principalId)throw new Error('knowledge proposal ownership mismatch');
    return p.kind === 'atlas' ? this.proposeAtlas(p) : this.proposeMemory(p);
  }

  private async proposeAtlas(p: AtlasProposal): Promise<KnowledgeProposalResult> {
    if (p.evidenceRefs.length === 0) {
      return { accepted: false, disposition: 'rejected', reason: 'agent atlas proposal needs a non-empty evidence chain' };
    }
    const result = await this.d.ingestion.ingest({
      kind: 'extracted_fact',
      correlationId: p.correlationId,
      principalId: p.principalId,
      provenance: {
        method: 'inference', producedBy: 'agent', producedOn: 'local-server',
        producedAt: this.d.clock.nowIso(), correlationId: p.correlationId, derivedFromUntrusted: true,
      },
      fact: {
        subjectRef: p.subjectRef, attribute: p.attribute,
        ...(p.predicate ? { predicate: p.predicate } : {}),
        value: p.value, epistemicStatus: capEpistemicStatus(p.epistemicStatus),
        confidence: Math.min(0.85, Math.max(0, p.confidence)), evidenceRefs: p.evidenceRefs,
      },
    });
    if (p.causal) {
      await this.d.ingestion.hypothesise({
        principalId: p.principalId, correlationId: p.correlationId, causeRef: p.causal.causeRef,
        effectRef: p.causal.effectRef, relationKind: p.causal.relationKind, confidence: Math.min(0.8, p.confidence),
        evidence: p.evidenceRefs, method: 'agent-proposal', origin: 'cognition',
      });
    }
    if (result.conflictId) {
      return { accepted: true, disposition: 'conflict', reason: 'recorded alongside a contradicting belief, not overwritten', ...(result.atlasFactId ? { factId: result.atlasFactId } : {}), conflictId: result.conflictId };
    }
    if (result.atlasFactId) return { accepted: true, disposition: 'fact', factId: result.atlasFactId };
    return { accepted: false, disposition: 'rejected', reason: result.routed.rationale };
  }

  private async proposeMemory(p: MemoryProposal): Promise<KnowledgeProposalResult> {
    const result = await this.d.ingestion.ingest({
      kind: 'episode',
      correlationId: p.correlationId,
      principalId: p.principalId,
      provenance: {
        method: 'inference', producedBy: 'agent', producedOn: 'local-server',
        producedAt: this.d.clock.nowIso(), correlationId: p.correlationId, derivedFromUntrusted: true,
      },
      episode: {
        kind: 'agent_note', title: p.title, summary: p.summary, occurredFrom: p.occurredFrom,
        occurredTo: p.occurredTo, participantsRefs: p.participantsRefs, sourceEventIds: p.sourceEventIds,
        ...(p.salienceHint !== undefined ? { salienceHint: p.salienceHint } : {}),
      },
    });
    return result.mnemosyneCandidateId
      ? { accepted: true, disposition: 'candidate', candidateId: result.mnemosyneCandidateId, reason: 'queued for the scorer gate' }
      : { accepted: false, disposition: 'rejected', reason: result.routed.rationale };
  }
}
