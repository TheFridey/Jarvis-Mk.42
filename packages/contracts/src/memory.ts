/**
 * MNEMOSYNE durable memory classes (docs/architecture/MNEMOSYNE_MODEL.md).
 *
 * Writers: the Kernel Knowledge Ingestion mediator ONLY.
 *
 * Five durable classes are schema-backed here. Three transient/borrowed classes
 * are NOT modelled as MNEMOSYNE records (MNEMOSYNE_MODEL.md §Classes):
 *   - working memory  -> Kernel Ephemeral store (Redis); MNEMOSYNE only reads it
 *   - session memory  -> a projection over session.* events
 *   - spatial memory  -> a reference to the Scene service; only `sceneRef` here
 * `entity memory` is a QUERY (episodes + semantic rows linked to an ATLAS
 * entity id), not a table.
 */

import type { Confidence, PrincipalId, Timestamp, Ulid } from './common.ts';
import type { PrivacyClass } from './entity.ts';

export type MemoryClass = 'episodic' | 'semantic' | 'procedural' | 'preference';

/** A bounded slice of experience. Narrative, lossy, decays. Never authoritative. */
export interface Episode {
  id: Ulid;
  kind: string; // "conversation" | "action_outcome" | "event_sequence" | "consolidation" | ...
  title: string;
  summary: string;

  /** Object-storage reference to the full body, if retained. */
  bodyRef?: string;

  occurredFrom: Timestamp;
  occurredTo: Timestamp;

  /** ATLAS entity ids involved. */
  participants: Ulid[];

  /** The events this episode was built from. */
  sourceEventIds: Ulid[];

  /** 0..1 importance estimate; drives retention and recall ranking. */
  salience: number;

  privacyClass: PrivacyClass;

  /** Reference into the Scene service, if the episode is spatially situated. */
  sceneRef?: string;

  principalId: PrincipalId;
  createdAt: Timestamp;

  /** Set when merged into another episode by consolidation. */
  supersededBy?: Ulid;
  archivedAt?: Timestamp;
}

/** A durable learned concept or knowledge statement. */
export interface SemanticMemory {
  id: Ulid;
  statement: string;
  confidence: Confidence;
  sourceEpisodeIds: Ulid[];
  privacyClass: PrivacyClass;
  /** relevance × age drives the prune-candidate score (MNEMOSYNE_MODEL.md §Forgetting). */
  relevance: number;
  principalId: PrincipalId;
  createdAt: Timestamp;
  lastReinforcedAt?: Timestamp;
}

export interface ProcedureStep {
  step: number;
  action: string;
  /** Optional reference to a verification/check for this step. */
  checkRef?: string;
}

/** A repeatable process, e.g. "Deploy ScaleSmiths". */
export interface Procedure {
  id: Ulid;
  name: string;
  steps: ProcedureStep[];
  version: number;
  sourceEpisodeIds: Ulid[];
  principalId: PrincipalId;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastValidatedAt?: Timestamp;
}

/**
 * A non-sensitive interaction preference. `privacyClass` is capped at INTERNAL
 * by the MNEMOSYNE service — sensitive personal facts belong in ATLAS, not here.
 */
export interface Preference {
  id: Ulid;
  key: string; // "notification.style" | "editor" | "verbosity" | ...
  value: unknown;
  privacyClass: 'PUBLIC' | 'INTERNAL';
  confidence: Confidence;
  sourceEpisodeIds: Ulid[];
  principalId: PrincipalId;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
