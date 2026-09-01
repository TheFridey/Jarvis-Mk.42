/**
 * Provenance — the origin of a fact, observation, or event.
 *
 * Mandatory on every Fact (L11) and every Event. A World Model service that is
 * handed a fact without provenance MUST reject it. "Why does JARVIS believe
 * this?" is answerable by walking provenance + evidence (L15).
 */

import type { CorrelationId, NodeId, Timestamp } from './common.ts';

/** How the information came to be held (L14). */
export type EpistemicStatus =
  | 'observed' // sensed directly by perception
  | 'asserted' // stated by a principal
  | 'retrieved' // fetched from an external source
  | 'inferred' // deduced by reasoning
  | 'predicted' // a forecast about the future
  | 'derived'; // computed from other facts by a deterministic function

/** The mechanism that produced the information. */
export type ProvenanceMethod =
  | 'sensor'
  | 'model'
  | 'retrieval'
  | 'inference'
  | 'assertion'
  | 'derivation'
  | 'system';

export interface Provenance {
  method: ProvenanceMethod;

  /** Component / adapter / agent id that produced this. */
  producedBy: string;

  /** Node the producer ran on. */
  producedOn: NodeId;

  producedAt: Timestamp;

  /** Set when method = "model": which model + version answered. */
  model?: { id: string; version: string };

  /**
   * Opaque references to supporting material: source-event ids, URLs, parent
   * fact ids, session/episode ids, inference-run ids. The evidence graph
   * (WORLD_MODEL.md §2) expands these.
   */
  sourceRefs?: string[];

  /** The interaction that produced this. */
  correlationId: CorrelationId;

  /**
   * True if the evidence chain includes untrusted web/external content
   * (SECURITY_MODEL.md §4.3, ADR-0018). Such information may not alone justify
   * an action above riskClass LOW, nor be stored with epistemicStatus stronger
   * than "retrieved".
   */
  derivedFromUntrusted: boolean;
}
