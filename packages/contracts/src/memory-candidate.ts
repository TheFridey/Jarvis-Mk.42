/**
 * MNEMOSYNE memory-candidate pipeline (MNEMOSYNE_MODEL.md §Memory Candidate pipeline).
 *
 * Events tagged retentionClass MEMORY_CANDIDATE (plus session/objective
 * outcomes) land here first. Nothing becomes an Episode without passing this
 * gate. Not every conversation line is stored.
 */

import type { PrincipalId, Timestamp, Ulid } from './common.ts';

export type CandidateDisposition =
  | 'pending'
  | 'accepted'
  | 'merged'
  | 'rejected'
  | 'expired'
  | 'deferred';

/**
 * The scorer's component breakdown, persisted for audit and tuning
 * ("Why do you remember that?"). Each component is 0..1.
 */
export interface CandidateScore {
  novelty: number;
  importance: number;
  futureUtility: number;
  objectiveRelevance: number;
  confidence: number;
  /** Penalty component: 1 = fully duplicated, 0 = unique. */
  duplication: number;
  /** Penalty/defer component: 1 = highly sensitive. */
  sensitivity: number;
  durability: number;
  sourceQuality: number;
  /** The single weighted result the disposition threshold is applied to. */
  composite: number;
}

export interface MemoryCandidate {
  id: Ulid;
  sourceEventId: Ulid;
  sourceKind: string; // "event" | "session_outcome" | "objective_outcome"
  /** The raw material being scored (utterance, outcome summary, event payload slice). */
  content: unknown;
  score?: CandidateScore;
  disposition: CandidateDisposition;
  disposedAt?: Timestamp;
  /** Set when disposition = "merged" or "accepted". */
  episodeId?: Ulid;
  principalId: PrincipalId;
  createdAt: Timestamp;
}
