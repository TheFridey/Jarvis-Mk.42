import type { DomainRequest } from './domain.ts';
/**
 * MNEMOSYNE read service interface (docs/architecture/MNEMOSYNE_MODEL.md §Retrieval,
 * docs/architecture/adr/0023-memory-retrieval-ranking.md).
 *
 * Recall is ALWAYS top-k + relevance floor — never "all relevant". The relevance
 * score is a seven-factor weighted composite; semantic similarity is ONE bounded
 * factor. Cosine similarity does not dictate truth.
 *
 * Implementation lands in a later plan under packages/memory/.
 */

import type { Timestamp, Ulid } from './common.ts';
import type {
  Episode,
  MemoryClass,
  Preference,
  Procedure,
  SemanticMemory,
} from './memory.ts';

/** Tunable weights, from config, logged with each recall (ADR-0023). `sim` is
 *  bounded so similarity alone cannot dominate. */
export interface RecallWeights {
  sim: number;
  entity: number;
  recency: number;
  importance: number;
  objective: number;
  confidence: number;
  sourceAuthority: number;
}

export interface RecallQuery extends DomainRequest {
  /** Natural-language or structured query text; the service embeds it. */
  text: string;
  /** ATLAS entity ids in scope, for the entity-overlap factor. */
  entityIds?: Ulid[];
  /** Active objective ids, for the objective-relevance factor. */
  objectiveIds?: Ulid[];
  classes?: MemoryClass[];
  principalId: string;
  k: number;
  /** Relevance floor; items below are not returned. */
  floor: number;
  asOf?: Timestamp;
}

export type RecalledItem =
  | { class: 'episodic'; item: Episode; relevance: number }
  | { class: 'semantic'; item: SemanticMemory; relevance: number }
  | { class: 'procedural'; item: Procedure; relevance: number }
  | { class: 'preference'; item: Preference; relevance: number };

export interface MemoryRecall {
  recall(query: RecallQuery): Promise<{
    items: RecalledItem[];
    weightsUsed: RecallWeights;
  }>;

  /** History associated with an ATLAS entity (a query, not a stored class). */
  entityMemory(entityId: Ulid, principalId: string, k: number): Promise<{
    items: RecalledItem[];
  }>;
}
