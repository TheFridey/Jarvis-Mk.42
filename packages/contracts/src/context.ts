/**
 * Context Compiler contracts (deterministic scaffold - COGNITION_MODEL.md sec 4).
 *
 * Produces an Intent-Specific Context Package: a bounded, ranked, privacy-
 * filtered, deduplicated, versioned bundle. MK.43 uses deterministic heuristics
 * only - no AI retrieval. Every item carries provenance.
 */

import type { CorrelationId, Timestamp, Ulid } from './common.ts';
import type { PrivacyClass } from './event.ts';
import type { Provenance } from './provenance.ts';

export type ContextItemKind =
  | 'active_objective'
  | 'active_workspace'
  | 'conversation_turn'
  | 'working_memory'
  | 'long_term_memory' // FUTURE source - slot reserved
  | 'world_entity' // FUTURE source - slot reserved
  | 'recent_event'
  | 'active_application'
  | 'selected_object'
  | 'cursor_target'
  | 'gesture_target'
  | 'location'
  | 'presence'
  | 'available_capability'
  | 'policy'
  | 'evidence';

export interface ContextItem {
  id: Ulid;
  kind: ContextItemKind;
  /** Short human-readable rendering of the item. */
  summary: string;
  /** The structured content. */
  content: unknown;
  provenance: Provenance;
  privacyClass: PrivacyClass;
  /** Deterministic relevance score in [0,1]. */
  relevance: number;
  /** Approximate size cost in context units. */
  sizeUnits: number;
  /** Stable content hash for deduplication. */
  contentHash: string;
}

export interface ContextRequest {
  correlationId: CorrelationId;
  /** What the context is being compiled for. */
  intent: string;
  intentClass: string;
  /** Hard ceiling in context units. The package never exceeds this. */
  budgetUnits: number;
  /** Slices/keys the requester considers salient (hint for ranking). */
  focusRefs?: string[];
  /** Privacy ceiling: items above this class are filtered out. */
  maxPrivacyClass: PrivacyClass;
}

export interface ContextPackage {
  id: Ulid;
  /** Monotonic per compiler instance; lets consumers detect newer packages. */
  version: number;
  request: ContextRequest;
  compiledAt: Timestamp;

  items: ContextItem[];

  budget: {
    limitUnits: number;
    usedUnits: number;
    /** True if ranked items were dropped to fit. */
    truncated: boolean;
    /** Summaries of items omitted for budget, highest-relevance first. */
    omitted: string[];
  };

  /** Explicit "no information" markers (L17). */
  unknowns: string[];

  filtered: {
    /** Count removed by privacy ceiling. */
    byPrivacy: number;
    /** Count removed as duplicates. */
    byDedupe: number;
  };
}
