import type { DomainRequest } from './domain.ts';
/**
 * Bounded knowledge interface for agents (ORACLE, SCOUT, FORGE).
 *
 * Agents MAY query relevant ATLAS/MNEMOSYNE knowledge and MAY propose updates.
 * They MAY NOT mutate authoritative records. Every proposed write is wrapped as
 * an `IngestionItem` with `provenance.derivedFromUntrusted = true` and routed
 * through the Knowledge Ingestion mediator, which validates, resolves entities,
 * classifies privacy, and decides supersession/conflict (ADR-0020).
 *
 * Implementation: `KnowledgeAgentFacade` in apps/core/src/kernel/knowledge/.
 */

import type { PrincipalId, Timestamp, Ulid } from './common.ts';
import type { EpistemicStatus } from './provenance.ts';
import type { RelationKind } from './causal.ts';
import type { Fact, Evidence } from './fact.ts';
import type { EntityRelationship } from './entity.ts';
import type { RecalledItem } from './memory-recall.ts';

/** A read request an agent may make. `k` and `principalId` are always enforced
 *  by the facade; an agent cannot widen its own scope. */
export interface KnowledgeQuery extends DomainRequest {
  principalId: PrincipalId;
  /** Free text the facade embeds for similarity + uses for entity resolution. */
  text: string;
  /** ATLAS entity ids already in scope (from the current ContextPackage). */
  entityIds?: Ulid[];
  objectiveIds?: Ulid[];
  /** Hard cap on returned items per class. Facade clamps to its own maximum. */
  k: number;
  asOf?: Timestamp;
}

export interface KnowledgeQueryResult {
  facts: Fact[];
  relationships: EntityRelationship[];
  memories: RecalledItem[];
  /** Populated for `explain()` style calls. */
  evidence?: Evidence[];
  /** Explicit "nothing known" markers (L17). */
  unknowns: string[];
}

/** An agent's proposed ATLAS write. Never applied directly. */
export interface AtlasProposal {
  kind: 'atlas';
  principalId: PrincipalId;
  correlationId: string;
  /** Entity id or a resolvable descriptor (name/email/url). */
  subjectRef: string;
  attribute: string;
  predicate?: string;
  value: unknown;
  /** Agent-proposed status; the mediator caps it (an agent cannot assert
   *  `observed`/`asserted` — those get downgraded to `inferred`). */
  epistemicStatus: EpistemicStatus;
  confidence: number;
  /** Non-empty: event ids, source urls, episode ids. */
  evidenceRefs: string[];
  /** Optional causal claim; the mediator caps `relationKind` at
   *  `hypothesised_cause` for agent origin (ADR-0021). */
  causal?: { causeRef: string; effectRef: string; relationKind: RelationKind };
}

/** An agent's proposed MNEMOSYNE write (an episode candidate). Never applied
 *  directly — it enters the candidate pipeline and must pass the scorer gate. */
export interface MemoryProposal {
  kind: 'memory';
  principalId: PrincipalId;
  correlationId: string;
  title: string;
  summary: string;
  occurredFrom: Timestamp;
  occurredTo: Timestamp;
  participantsRefs: string[];
  sourceEventIds: Ulid[];
  salienceHint?: number;
}

export type KnowledgeProposal = AtlasProposal | MemoryProposal;

export interface KnowledgeProposalResult {
  accepted: boolean;
  /** `candidate` (queued for the scorer), `fact` (written), `conflict`
   *  (recorded, not overwritten), `rejected` (failed validation/ceiling). */
  disposition: 'candidate' | 'fact' | 'conflict' | 'rejected';
  factId?: Ulid;
  candidateId?: Ulid;
  conflictId?: Ulid;
  reason?: string;
}

export interface KnowledgeAgentFacade {
  query(q: KnowledgeQuery): Promise<KnowledgeQueryResult>;
  /** "Why do you believe fact X?" — evidence + provenance chain. */
  explain(factId: Ulid, principalId: PrincipalId): Promise<KnowledgeQueryResult>;
  propose(p: KnowledgeProposal): Promise<KnowledgeProposalResult>;
}
