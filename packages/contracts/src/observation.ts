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
