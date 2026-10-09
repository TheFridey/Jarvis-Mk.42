import type { DomainOwned } from './domain.ts';
/**
 * MNEMOSYNE morning-insight mechanism (MNEMOSYNE_MODEL.md §Morning Insight).
 *
 * Consolidation writes candidate insights. A surfacing check emits
 * `jarvis.memory.insight.available` ONLY when: significance >= threshold AND
 * relevant to a current objective/context AND not already surfaced AND
 * evidence-backed. The Notification Manager delivers it under its normal gate.
 * Zero insights on a run is the expected normal case — no insight is fabricated.
 */

import type { PrincipalId, Timestamp, Ulid } from './common.ts';
import type { Provenance } from './provenance.ts';

export type InsightSignificance = number; // 0..1

export interface Insight extends DomainOwned {
  id: Ulid;
  statement: string;
  significance: InsightSignificance;
  /** Supporting refs: episode ids, fact ids, event ids. Non-empty — an insight
   *  with no evidence chain is rejected at ingestion. */
  evidence: Ulid[];
  /** How this insight came to be held (L11); a consolidation output with no
   *  evidence chain is rejected at ingestion (ADR-0022). */
  provenance: Provenance;
  surfaced: boolean;
  surfacedAt?: Timestamp;
  supersededBy?: Ulid;
  consolidationRunId: Ulid;
  principalId: PrincipalId;
  createdAt: Timestamp;
}
