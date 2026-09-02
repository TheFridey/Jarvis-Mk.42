/**
 * ATLAS read service interface (docs/architecture/ATLAS_MODEL.md §Retrieval).
 * The Context Compiler and cognition query API bind to this. It NEVER calls
 * MemoryRecall — fusion happens only in the Context Compiler.
 *
 * Implementation lands in a later plan under packages/world-model/.
 */

import type { Known, Timestamp, Ulid } from './common.ts';
import type { Fact, Evidence } from './fact.ts';
import type { EntityRelationship } from './entity.ts';
import type { CausalHypothesis } from './causal.ts';

export interface FactHistoryEntry {
  fact: Fact;
  supersededByFactId?: Ulid;
}

export interface AtlasChange {
  factId: Ulid;
  subjectEntityId: Ulid;
  attribute: string;
  changeKind: 'asserted' | 'superseded' | 'expired' | 'retracted';
  at: Timestamp;
}

export interface AtlasQuery {
  /** "What is true now?" — validFrom <= now < validTo, ranked by confidence. */
  currentlyBelieved(
    entityId: Ulid,
    attribute?: string,
  ): Promise<Known<{ facts: Fact[] }>>;

  /** "What was true at t?" — includes facts_archive. */
  believedAt(
    entityId: Ulid,
    attribute: string | undefined,
    t: Timestamp,
  ): Promise<Known<{ facts: Fact[] }>>;

  /** "What changed between t1 and t2?" — caller supplies the deployment boundary. */
  changedBetween(t1: Timestamp, t2: Timestamp, filter?: {
    entityId?: Ulid;
    attribute?: string;
  }): Promise<{ changes: AtlasChange[] }>;

  /** "When did belief Y begin? What did we previously believe?" */
  history(entityId: Ulid, attribute: string): Promise<{ chain: FactHistoryEntry[] }>;

  /** "What evidence supports this?" */
  evidenceFor(factId: Ulid): Promise<{ evidence: Evidence[] }>;

  /** Time-scoped relationship neighbourhood. */
  relationships(entityId: Ulid, opts?: {
    at?: Timestamp;
    kinds?: string[];
  }): Promise<{ relationships: EntityRelationship[] }>;

  /** Causal hypotheses touching a node; relationKind returned verbatim. */
  causal(ref: string, direction: 'cause' | 'effect' | 'both'): Promise<{
    hypotheses: CausalHypothesis[];
  }>;
}
