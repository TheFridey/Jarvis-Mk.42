import { randomUUID } from 'node:crypto';
import type { DomainService } from '../domains/domain-service.ts';
import { currentDomainScope } from '../domains/scope.ts';
/**
 * `AtlasQuery` implementation (contract: packages/contracts/src/atlas-query.ts,
 * ATLAS_MODEL.md §8). Read-only. Never calls `MemoryRecall` — fusion happens
 * only in the Context Compiler.
 *
 * Bound to the active principal (single-principal MK.42, mirrors PresenceManager)
 * so the contract's principal-less methods stay principal-scoped (L34).
 *
 * Every method can return `{ known: false }` as a real answer (L17), distinct
 * from a low-confidence hit.
 */
import type {
  AtlasChange,
  AtlasQuery,
  CausalHypothesis,
  Evidence,
  EntityRelationship,
  Fact,
  FactHistoryEntry,
  Known,
  Timestamp,
  Ulid,
} from '@jarvis/contracts';
import type { Clock } from '../../runtime/clock.ts';
import type { AtlasStore } from './stores.ts';

export class AtlasQueryService implements AtlasQuery {
  constructor(
    private readonly deps: { domains?:DomainService; store: AtlasStore; clock: Clock; principalId: () => string },
  ) {}

  async currentlyBelieved(entityId: Ulid, attribute?: string): Promise<Known<{ facts: Fact[] }>> {
    const now = this.deps.clock.nowIso();
    const all = await this.deps.store.activeFacts(this.deps.principalId(), entityId, attribute);
    const facts = all.filter((f) => f.validFrom <= now && (!f.validTo || f.validTo > now));
    if (facts.length === 0) return { known: false };
    return { known: true, value: { facts }, confidence: Math.max(...facts.map((f) => f.confidence)) };
  }

  async believedAt(
    entityId: Ulid, attribute: string | undefined, t: Timestamp,
  ): Promise<Known<{ facts: Fact[] }>> {
    const facts = await this.deps.store.factsValidAt(this.deps.principalId(), entityId, attribute, t);
    if (facts.length === 0) return { known: false };
    return { known: true, value: { facts }, confidence: Math.max(...facts.map((f) => f.confidence)) };
  }

  async changedBetween(
    t1: Timestamp, t2: Timestamp, filter?: { entityId?: Ulid; attribute?: string },
  ): Promise<{ changes: AtlasChange[] }> {
    const facts = await this.deps.store.factsChangedBetween(this.deps.principalId(), t1, t2, filter ?? {});
    const changes: AtlasChange[] = [];
    for (const f of facts) {
      if (f.validFrom >= t1 && f.validFrom < t2) {
        changes.push({ factId: f.id, subjectEntityId: f.subjectEntityId, attribute: f.attribute, changeKind: 'asserted', at: f.validFrom });
      }
      if (f.supersededAt && f.supersededAt >= t1 && f.supersededAt < t2) {
        const kind = f.status === 'retracted' ? 'retracted' : f.status === 'expired' ? 'expired' : 'superseded';
        changes.push({ factId: f.id, subjectEntityId: f.subjectEntityId, attribute: f.attribute, changeKind: kind, at: f.supersededAt });
      } else if (f.validTo && f.validTo >= t1 && f.validTo < t2 && f.status === 'expired') {
        changes.push({ factId: f.id, subjectEntityId: f.subjectEntityId, attribute: f.attribute, changeKind: 'expired', at: f.validTo });
      }
    }
    changes.sort((a, b) => a.at.localeCompare(b.at));
    return { changes };
  }

  async history(entityId: Ulid, attribute: string): Promise<{ chain: FactHistoryEntry[] }> {
    const facts = await this.deps.store.factHistory(this.deps.principalId(), entityId, attribute);
    const bySupersedes = new Map<string, string>();
    for (const f of facts) if (f.supersedesFactId) bySupersedes.set(f.supersedesFactId, f.id);
    const chain: FactHistoryEntry[] = facts.map((fact) => {
      const supersededByFactId = bySupersedes.get(fact.id);
      return supersededByFactId ? { fact, supersededByFactId } : { fact };
    });
    return { chain };
  }

  async evidenceFor(factId: Ulid): Promise<{ evidence: Evidence[] }> {
    if(this.deps.domains&&!currentDomainScope())return this.deps.domains.run(this.deps.principalId(),{},'atlas-evidence:'+randomUUID(),()=>this.evidenceFor(factId));
    const fact=await this.deps.store.getFact(factId);if(!fact||fact.principalId!==this.deps.principalId())return {evidence:[]};
    return { evidence: await this.deps.store.evidenceFor(factId) };
  }

  async relationships(
    entityId: Ulid, opts?: { at?: Timestamp; kinds?: string[] },
  ): Promise<{ relationships: EntityRelationship[] }> {
    if(this.deps.domains&&!currentDomainScope())return this.deps.domains.run(this.deps.principalId(),{},'atlas-relationships:'+randomUUID(),()=>this.relationships(entityId,opts));
    const entity=await this.deps.store.getEntity(entityId);if(!entity||entity.principalId!==this.deps.principalId())return {relationships:[]};
    return { relationships: await this.deps.store.relationshipsFor(entityId, opts ?? {}) };
  }

  async causal(
    ref: string, direction: 'cause' | 'effect' | 'both',
  ): Promise<{ hypotheses: CausalHypothesis[] }> {
    return { hypotheses: await this.deps.store.causalTouching(this.deps.principalId(), ref, direction) };
  }
}
