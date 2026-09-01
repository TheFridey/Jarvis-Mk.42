/**
 * Common primitive aliases used across all JARVIS contracts.
 *
 * GENESIS PHASE: types only. No runtime code. These shapes are subordinate to
 * docs/architecture/PRINCIPLES.md and may only evolve additively (see
 * docs/architecture/ROADMAP.md "The invariant").
 */

/** ULID string. Time-sortable, globally unique. Used for all event ids. */
export type Ulid = string;

/** RFC3339 UTC timestamp string. */
export type Timestamp = string;

/** A stable identifier for one end-to-end interaction (L15, audit). */
export type CorrelationId = string;

/** The id of the event or command that directly caused another event. */
export type CausationId = string;

/**
 * The single human (later: autonomous) identity on whose behalf JARVIS acts.
 * MK.42 has exactly one; every authoritative row carries it (L34).
 */
export type PrincipalId = string;

/** 0..1 inclusive. Mandatory on every Fact (L12) and relationship. */
export type Confidence = number;

/** Identifier of a node in the Node Protocol registry. */
export type NodeId = string;

/** Seven architectural planes (docs/architecture/MK42_ARCHITECTURE.md §4). */
export type Plane =
  | 'experience'
  | 'kernel'
  | 'perception'
  | 'cognition'
  | 'agency'
  | 'world'
  | 'data'
  | 'infra';

/** Result of a lookup that may legitimately have no answer (L17). */
export type Known<T> =
  | { known: true; value: T; confidence: Confidence }
  | { known: false };
