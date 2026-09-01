/**
 * Audit — the append-only trail derived from ledger events (L31).
 *
 * Governance: docs/architecture/SECURITY_MODEL.md §8
 *
 * The Audit Manager is READ-ONLY with respect to everything else. Audit records
 * are never mutated or deleted; old partitions move to cold storage while
 * staying queryable.
 */

import type { CorrelationId, PrincipalId, Timestamp, Ulid } from './common.ts';

export type AuditCategory =
  | 'policy_decision'
  | 'grant_change'
  | 'capability_invocation'
  | 'model_call'
  | 'node_admission'
  | 'objective_transition'
  | 'world_model_write'
  | 'auth_event';

export interface AuditRecord {
  id: Ulid;
  category: AuditCategory;

  /** The event(s) this record was derived from. */
  sourceEventIds: Ulid[];

  correlationId: CorrelationId;
  principalId: PrincipalId;

  /** Denormalised for query without walking the event log. */
  actor: string;
  summary: string;
  outcome: string;

  /** Full structured detail (policy rule ids fired, scopes, verify report…). */
  detail: unknown;

  occurredAt: Timestamp;
  recordedAt: Timestamp;
}

/** A reconstructed "why did this happen" trace for one interaction. */
export interface AuditTrace {
  correlationId: CorrelationId;
  records: AuditRecord[];
  /** Ordered causation chain of event ids. */
  causationChain: Ulid[];
}
