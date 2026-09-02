/**
 * Fact — a structured belief in ATLAS (docs/architecture/ATLAS_MODEL.md).
 *
 * `factType` is not a separate field: the six `epistemicStatus` values ARE the
 * fact types (observed / asserted / retrieved / inferred / predicted / derived).
 * JARVIS treats them as meaning different things — see the authority ranking in
 * ATLAS_MODEL.md §Belief revision.
 *
 * INVARIANTS (enforced by the ATLAS service, not the type system):
 *  - provenance mandatory (L11); confidence mandatory 0..1 (L12)
 *  - epistemicStatus mandatory, never defaulted (L14)
 *  - temporal validity via validFrom/validTo (L13)
 *  - contradictions RECORDED (conflicts + contradictionOf), never silently
 *    overwritten (L16)
 *  - a fact is never merely key=value: `predicate` carries the
 *    subject–predicate–object form when the statement is relational
 *
 * `status`, `privacyClass`, and `contradictionOf` are REQUIRED, not optional:
 * the Knowledge Ingestion service always fills them (defaults `status: 'active'`,
 * `privacyClass: 'INTERNAL'`, `contradictionOf: []`), so every producer sees
 * them present. A partially-populated belief row is an epistemics defect, not a
 * valid state (L11) — mirrors the same rule on `Entity`.
 */

import type { Confidence, PrincipalId, Timestamp, Ulid } from './common.ts';
import type { EpistemicStatus, Provenance } from './provenance.ts';
import type { PrivacyClass } from './event.ts';

/** Lifecycle of a fact row. `active` is the only state in the hot `facts` table;
 *  the rest live in `facts_archive` (ATLAS_MODEL.md §Belief revision). */
export type FactStatus = 'active' | 'superseded' | 'retracted' | 'expired';

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

  /** Subject–predicate–object form, when relational. Optional: attribute-only
   *  facts (`role`, `email`) leave this undefined. */
  predicate?: string;

  status: FactStatus;

  privacyClass: PrivacyClass;

  /** Explicit links to facts this one contradicts (complements the `conflicts`
   *  table with a direct edge). Empty array, never null. */
  contradictionOf: Ulid[];

  /** Set when status left `active`. Drives `changedBetween` queries. */
  supersededAt?: Timestamp;

  /** Set when this fact refines/replaces an earlier one for the same key. */
  supersedesFactId?: Ulid;

  createdAt: Timestamp;
}

/**
 * A link from a belief to the material that supports it (L15). Mirrors the
 * shared `atlas.evidence` table: one evidence graph spanning facts,
 * relationships, and causal hypotheses, discriminated by `subjectKind`. The
 * `'episode'` kind is the only legal ATLAS -> MNEMOSYNE coupling (ADR-0020
 * point 2): an evidence row may cite a MNEMOSYNE episode id via `ref`; content
 * is never copied.
 */
export type EvidenceKind =
  | 'observation'
  | 'source_document'
  | 'parent_fact'
  | 'principal_assertion'
  | 'inference_run'
  | 'episode';

export interface Evidence {
  id: Ulid;
  /** What this evidence supports. */
  subjectKind: 'fact' | 'relationship' | 'causal_hypothesis';
  subjectId: Ulid;
  kind: EvidenceKind;
  /** signal-event id | url | fact id | session/episode id | run id. */
  ref: string;
  weight?: number;
  note?: string;
  principalId: PrincipalId;
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
  principalId: PrincipalId;
  recordedAt: Timestamp;
}

/** A Fact plus its relevance score, as delivered inside a ContextFrame. */
export interface ScoredFact {
  fact: Fact;
  relevance: number;
}
