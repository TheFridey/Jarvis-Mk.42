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
  | 'long_term_memory'
  | 'world_entity' // ATLAS entity (MK.46)
  | 'world_relationship' // ATLAS entity_relationship (MK.46)
  | 'world_fact' // ATLAS fact (MK.46)
  | 'world_observation' // ATLAS observation index row (MK.46)
  | 'world_conflict' // ATLAS unresolved conflict (MK.46)
  | 'causal_hypothesis' // ATLAS causal hypothesis, relationKind verbatim (MK.46)
  | 'episodic_memory' // MNEMOSYNE episode (MK.46)
  | 'semantic_memory' // MNEMOSYNE learned statement (MK.46)
  | 'procedural_memory' // MNEMOSYNE procedure (MK.46)
  | 'memory_preference' // MNEMOSYNE preference (MK.46)
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

/** Which subsystem an item came from — carried end to end so cognition and
 *  audit can trace every context item to its owner (MK.46). */
export type ContextSourceType =
  | 'kernel_state'
  | 'event_log'
  | 'atlas'
  | 'mnemosyne'
  | 'capability_registry'
  | 'derivation';

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
  /** Owning subsystem (MK.46). Absent on pre-MK.46 items => treat as 'kernel_state'. */
  sourceType?: ContextSourceType;
  /** Belief/recall confidence in [0,1], when the source carries one (facts,
   *  relationships, episodes, observations). Absent for state slices. */
  confidence?: number;
}

export interface ContextRequest {
  principalId?:string;
  perceptionRef?:string;
  /** Verified capability evidence that must be kept in the package (budget reserved for it). */
  evidenceRef?:string;
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

  /**
   * The highest privacy class present among `items` (MK.46). Cognition routing
   * reads this to choose model locality: SENSITIVE/RESTRICTED context must go
   * to a local model or fail closed — never silently to cloud. `PUBLIC` when
   * the package is empty.
   */
  maxPrivacyClass: PrivacyClass;

  /** Staleness hints so cognition knows the knowledge subsystems may be behind
   *  the latest event (MK.46). Absent when neither source was consulted. */
  freshness?: {
    atlasAsOf?: Timestamp;
    memoryAsOf?: Timestamp;
  };
}
