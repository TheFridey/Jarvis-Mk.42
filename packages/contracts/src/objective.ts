import type { DomainOwned } from './domain.ts';
/**
 * Objective — a persistent goal JARVIS pursues across sessions and restarts
 * (L2). Owned solely by the Objective Engine, which is the single writer of
 * objective state (transitions serialised per objective id — review §16.10).
 *
 * Governance: docs/architecture/MK42_ARCHITECTURE.md, ROADMAP.md MK.48
 *
 * The Objective Engine decides WHAT should happen and WHY. The Scheduler
 * decides WHEN. They are different concerns (review §16.1).
 */

import type { CorrelationId, PrincipalId, Timestamp, Ulid } from './common.ts';
import type { Provenance } from './provenance.ts';

export type ObjectiveStatus =
  | 'proposed'
  | 'active'
  | 'blocked'
  | 'paused'
  | 'achieved'
  | 'abandoned'
  | 'failed';

export type ObjectiveOrigin =
  | 'principal' // the principal asked for it
  | 'derived' // decomposed from a parent objective
  | 'standing' // an ongoing responsibility (e.g. "keep CI green")
  | 'suggested'; // proposed by cognition, awaiting principal acceptance

export interface SuccessCriterion {
  id: Ulid;
  statement: string;
  /** How completion is checked: a query, a capability verify, or manual. */
  check: 'world_model_query' | 'capability_verify' | 'manual';
  met: boolean;
}

export interface Objective extends DomainOwned {
  id: Ulid;
  principalId: PrincipalId;
  parentObjectiveId?: Ulid;

  statement: string;
  origin: ObjectiveOrigin;
  status: ObjectiveStatus;

  successCriteria: SuccessCriterion[];

  /** Ordered child objectives produced by decomposition. */
  childObjectiveIds: Ulid[];
  dependencies: Ulid[];
  nextActions: string[];
  desiredState: Record<string, unknown>;
  nextEvaluationAt?: Timestamp;
  constraints: string[];
  authority: { mayReason: boolean; mayPlan: boolean; mayPropose: boolean; mayExecute: false };

  priority: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  deadline?: Timestamp;
  provenance: Provenance;
  history: Array<{ status: ObjectiveStatus; at: Timestamp; reason: string }>;

  /** The interaction that created it, for provenance/audit. */
  correlationId: CorrelationId;
}

/** A command to the Objective Engine; it is the only writer. */
export interface ObjectiveTransition {
  objectiveId: Ulid;
  to: ObjectiveStatus;
  reason: string;
  at: Timestamp;
}
