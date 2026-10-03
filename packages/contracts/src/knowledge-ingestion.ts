/**
 * Knowledge Ingestion — the SINGLE write path into ATLAS (atlas.*) and
 * MNEMOSYNE (mnemosyne.*) (docs/architecture/adr/0020-knowledge-subsystem-boundary.md).
 *
 * Kernel-internal protected service, same status as the Capability Executor:
 * named and protected by the Kernel Constitution, NOT a 17th frozen component.
 * Perception, cognition, agents, and interfaces never write either schema —
 * they emit observations, validated proposals, or principal-assertion commands
 * that arrive here.
 *
 * This file is the PORT (interface) only. The implementation lands in a later
 * plan under apps/core/src/kernel/knowledge/.
 */

import type { CorrelationId, PrincipalId, Timestamp, Ulid } from './common.ts';
import type { EpistemicStatus, Provenance } from './provenance.ts';
import type { PrivacyClass } from './event.ts';

export type IngestionKind =
  | 'perception_observation'
  | 'extracted_fact' // from a validated cognition proposal
  | 'episode' // a notable experience / action outcome
  | 'principal_assertion' // a Command from the Experience Plane
  | 'consolidation_output'; // a DREAMING proposal

/** One item offered to the mediator. The mediator — not the caller — decides
 *  routing, provenance stamping, privacy class, and entity resolution. */
export interface IngestionItem {
  kind: IngestionKind;
  correlationId: CorrelationId;
  principalId: PrincipalId;

  /** Caller-supplied provenance seed; the mediator completes/overrides it. */
  provenance: Provenance;

  /** Present for fact-bearing kinds. */
  fact?: {
    subjectRef: string; // entity id, or a resolvable descriptor
    entityType?: import('./entity.ts').EntityType;
    attribute: string;
    predicate?: string;
    value: unknown;
    epistemicStatus: EpistemicStatus;
    confidence: number;
    validFrom?: Timestamp;
    validTo?: Timestamp;
    evidenceRefs: string[];
  };

  /** Present for kind = "episode" or when an item carries both a fact and its
   *  originating experience. */
  episode?: {
    kind: string;
    title: string;
    summary: string;
    occurredFrom: Timestamp;
    occurredTo: Timestamp;
    participantsRefs: string[];
    sourceEventIds: Ulid[];
    salienceHint?: number;
  };

  /** Present for kind = "perception_observation". */
  observation?: {
    eventId: Ulid;
    kind: string;
    summary: string;
    source: string;
    node: string;
    observedAt: Timestamp;
    confidence: number;
    expiresAt: Timestamp;
    rawRef?: string;
  };

  privacyHint?: PrivacyClass;
}

export type RoutingTarget = 'atlas' | 'mnemosyne';

export interface RoutingDecision {
  targets: RoutingTarget[];
  /** e.g. "extracted_fact -> atlas only"; "proposal carrying both -> atlas fact + mnemosyne episode". */
  rationale: string;
}

export interface IngestionResult {
  routed: RoutingDecision;
  atlasFactId?: Ulid;
  atlasObservationId?: Ulid;
  atlasCausalHypothesisId?: Ulid;
  mnemosyneEpisodeId?: Ulid;
  mnemosyneCandidateId?: Ulid;
  /** Conflict opened rather than overwrite (L16). */
  conflictId?: Ulid;
  emittedEventIds: Ulid[];
}

export interface KnowledgeIngestion {
  ingest(item: IngestionItem): Promise<IngestionResult>;
}
