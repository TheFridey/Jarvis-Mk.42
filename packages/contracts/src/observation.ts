/**
 * Observation — a perception-produced record of something sensed.
 *
 * Governance: docs/architecture/PERCEPTION_MODEL.md
 *
 * Perception emits SIGNALS, not judgements. An Observation always carries
 * epistemicStatus "observed". It is never a conclusion. Perception may not
 * write the World Model or call a reasoning model (L7).
 */

import type { NodeId, Timestamp, Ulid } from './common.ts';

/** Coarse family of the sensed signal. */
export type ObservationDomain =
  | 'audio'
  | 'asr'
  | 'wake'
  | 'vision'
  | 'hands'
  | 'pose'
  | 'gaze'
  | 'presence'
  | 'screen'
  | 'app'
  | 'cursor'
  | 'doc'
  | 'env'
  | 'telemetry';

export interface Observation<TData = unknown> {
  id: Ulid;

  /** e.g. "jarvis.perception.asr.transcript". Always class "signal". */
  type: string;
  domain: ObservationDomain;

  /** Node whose sensor produced it. */
  node: NodeId;

  observedAt: Timestamp;

  /** Producer's own confidence in the signal, 0..1. */
  confidence: number;

  /** Domain-specific payload (transcript text, gesture label, dwell target…). */
  data: TData;

  /**
   * True if this observation was already debounced/aggregated from many raw
   * samples (PERCEPTION_MODEL.md §2, review §16.11), e.g. "cursor dwelled 3.2s".
   */
  aggregated?: boolean;
}

/** A lightweight reference to an Observation inside a ContextFrame. */
export interface ObservationRef {
  observationId: Ulid;
  type: string;
  observedAt: Timestamp;
  summary: string;
}

/**
 * AtlasObservation — the row ATLAS keeps as a durable index into a (soon to
 * expire) perception signal event. Distinct from `Observation` above:
 * `Observation` is what perception emits; `AtlasObservation` is what the
 * Knowledge Ingestion mediator writes to `atlas.observations`.
 *
 * Not all observations become Facts. A scheduled promotion evaluator aggregates
 * corroborating rows and, above threshold, PROPOSES a fact — it never writes one
 * directly (ATLAS_MODEL.md §Observation layer).
 */
export interface AtlasObservation {
  id: Ulid;

  /** The perception signal event this indexes. May already be expired. */
  eventId: Ulid;

  kind: string;
  summary: string;

  /** Producing component / sensor id. */
  source: string;

  /** Node whose sensor produced the underlying signal. */
  node: NodeId;

  observedAt: Timestamp;
  confidence: number;

  location?: { spaceId: string; ref?: string };

  /** Object-storage reference to the evidence artifact (frame, clip), if any. */
  rawRef?: string;

  /** Rolling window. Unpromoted observations are dropped past this. */
  expiresAt: Timestamp;

  /** Set once the promotion evaluator's proposal produced a fact. */
  promotedToFactId?: Ulid;
}
