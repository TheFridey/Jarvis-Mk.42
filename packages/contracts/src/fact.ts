/**
 * Fact — a structured belief in the World Model.
 *
 * Governance: docs/architecture/WORLD_MODEL.md
 *
 * INVARIANTS (contract-enforced by the World Model service):
 *  - provenance is mandatory (L11)
 *  - confidence is mandatory, 0..1 (L12)
 *  - epistemicStatus is mandatory and never defaulted (L14)
 *  - temporal validity via validFrom/validTo (L13)
 *  - contradictions are RECORDED as conflicts, never silently overwritten (L16)
 */

import type { Confidence, Timestamp, Ulid } from './common.ts';
import type { EpistemicStatus, Provenance } from './provenance.ts';

export interface Fact {
  id: Ulid;

  /** The entity this fact is about. */
  subjectEntityId: Ulid;

  /** Attribute key, e.g. "role", "status", "email", "preference:editor". */
  attribute: string;

  /** Attribute value. JSON-serialisable. */
  value: unknown;

  epistemicStatus: EpistemicStatus;
  provenance: Provenance;
  confidence: Confidence;

  validFrom: Timestamp;
  /** null / undefined => still believed current. */
  validTo?: Timestamp;

  /** Set when this fact refines/replaces an earlier one for the same key. */
  supersedesFactId?: Ulid;

  createdAt: Timestamp;
}

/** A link from a Fact to the material that supports it (L15). */
export type EvidenceKind =
  | 'observation'
  | 'source_document'
  | 'parent_fact'
  | 'principal_assertion'
  | 'inference_run';

export interface Evidence {
  id: Ulid;
  factId: Ulid;
  kind: EvidenceKind;
  /** signal-event id | url | fact id | session/episode id | run id. */
  ref: string;
  weight?: number;
  note?: string;
}

/** An unresolved disagreement between two facts (WORLD_MODEL.md §5). */
export type ConflictStatus =
  | 'open'
  | 'resolved_by_recency'
  | 'resolved_by_authority'
  | 'resolved_by_principal'
  | 'accepted_ambiguity';

export interface FactConflict {
  id: Ulid;
  subjectEntityId: Ulid;
  attribute: string;
  factIdA: Ulid;
  factIdB: Ulid;
  status: ConflictStatus;
  recordedAt: Timestamp;
}

/** A Fact plus its relevance score, as delivered inside a ContextFrame. */
export interface ScoredFact {
  fact: Fact;
  relevance: number;
}
