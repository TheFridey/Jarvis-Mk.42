/**
 * ContextFrame — the bounded, budgeted input assembled for ONE cognition task.
 *
 * Governance: docs/architecture/COGNITION_MODEL.md §4
 *
 * Built by the Kernel Context Compiler. It is provider-neutral: it contains NO
 * "chat message" shape (review §16.6). The gateway adapter serialises it for
 * whatever provider is chosen.
 *
 * The budget is a HARD bound. The Compiler fills by priority tiers and stops;
 * whatever it could not fit is listed in `budget.omitted` (review §16.12).
 * Unknowns are explicit (L17).
 */

import type { CorrelationId, Timestamp } from './common.ts';
import type { ScoredFact } from './fact.ts';
import type { ObservationRef } from './observation.ts';

export interface ObjectiveRef {
  objectiveId: string;
  statement: string;
  successCriteria: string[];
}

export interface Episode {
  episodeId: string;
  summary: string;
  occurredFrom: Timestamp;
  occurredTo: Timestamp;
  relevance: number;
}

/** An explicit "we have no information about X" marker (L17). */
export interface Unknown {
  about: string;
  reason: 'no_fact' | 'expired' | 'low_confidence_suppressed' | 'out_of_scope';
}

export interface SceneSlice {
  coordinateSpaceId: string;
  /** Opaque; shaped by packages/scene. Present only when spatially relevant. */
  contents: unknown;
}

export interface ContextBudget {
  /** Abstract context units; the gateway adapter maps to a provider tokenizer. */
  contextUnits: number;
  filled: number;
  truncated: boolean;
  /** Human-readable list of what was left out because the budget was reached. */
  omitted: string[];
}

export interface ContextFrame {
  task: {
    statement: string;
    class: string; // e.g. "reason" | "plan" | "summarize" | "extract"
  };

  objectives: ObjectiveRef[];
  facts: ScoredFact[]; // time-scoped, ranked by confidence x relevance
  observations: ObservationRef[]; // recent, relevant, aggregated
  recall: Episode[]; // top-k Memory, relevance >= floor
  unknowns: Unknown[];
  scene?: SceneSlice;

  constraints: string[];
  budget: ContextBudget;

  freshness: {
    worldModelAsOf: Timestamp;
    memoryAsOf: Timestamp;
  };

  correlationId: CorrelationId;
}
