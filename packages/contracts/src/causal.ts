/**
 * ATLAS causal-hypothesis foundations (docs/architecture/adr/0021-causal-hypothesis-model.md).
 *
 * FOUNDATIONS ONLY (MK.46): the typed store + the write discipline. No causal
 * inference engine ships this phase.
 *
 * The `RelationKind` ladder IS the safeguard against presenting correlation as
 * proven causation:
 *   - cognition proposals may reach at most `hypothesised_cause`
 *   - `established_cause` is writable ONLY by an explicit principal assertion or
 *     a deterministic derivation with named rule support
 *   - the query API returns `relationKind` verbatim so no consumer can mistake
 *     a hypothesis for a proven cause
 */

import type { Confidence, PrincipalId, Timestamp, Ulid } from './common.ts';

export type RelationKind =
  | 'chronological' // B happened after A; nothing more claimed
  | 'correlated' // A and B co-vary; no direction claimed
  | 'hypothesised_cause' // A may have caused B; evidence cited; not proven
  | 'established_cause'; // A caused B; assertion or rule-supported derivation only

export interface CausalHypothesis {
  id: Ulid;

  /** entity id | fact id | event id. */
  causeRef: string;
  /** entity id | fact id | event id. */
  effectRef: string;

  relationKind: RelationKind;
  confidence: Confidence;

  /** Supporting refs: event ids, fact ids, episode ids. */
  evidence: Ulid[];

  /** How this hypothesis was produced (free text: rule name, model run, assertion). */
  method: string;

  validFrom: Timestamp;
  validTo?: Timestamp;
  status: 'active' | 'retracted' | 'superseded';

  principalId: PrincipalId;
  createdAt: Timestamp;
}
