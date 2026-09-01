/**
 * Presence Manager contracts.
 *
 * Governance: docs/architecture/PERCEPTION_MODEL.md, KERNEL_CONSTITUTION.md sec 1 (#6).
 *
 * Tracks ONLY observable interaction state. NEVER infers mental state, emotion,
 * or medical state. Every presence value is backed by cited evidence.
 */

import type { Confidence, Timestamp, Ulid } from './common.ts';

export type PresenceState =
  | 'UNKNOWN' // no evidence either way
  | 'ABSENT' // positive evidence the principal is not here
  | 'PRESENT' // detected nearby / recently active
  | 'ENGAGED' // actively interacting (voice, input, workspace)
  | 'FOCUSED'; // sustained deep interaction with one workspace/app

export type PresenceEvidenceKind =
  | 'camera_presence' // vision.person.present observation
  | 'camera_absence'
  | 'input_activity' // keyboard/mouse
  | 'voice_interaction' // active ASR / wake
  | 'workspace_interaction' // focused app / edits
  | 'node_presence' // a personal device node is online & nearby
  | 'idle_timeout'; // absence inferred from sustained inactivity

export interface PresenceEvidence {
  kind: PresenceEvidenceKind;
  /** Event id of the observation this came from. */
  sourceEventId: Ulid;
  observedAt: Timestamp;
  confidence: Confidence;
  nodeId: string;
}

export interface PresenceSnapshot {
  principalId: string;
  state: PresenceState;
  confidence: Confidence;
  since: Timestamp;
  /** The evidence currently supporting this state (most recent first, bounded). */
  evidence: PresenceEvidence[];
  version: number;
}

/** Payload of `jarvis.kernel.presence.changed`. */
export interface PresenceChangedPayload {
  from: PresenceState;
  to: PresenceState;
  confidence: Confidence;
  drivingEvidence: PresenceEvidence;
  version: number;
}
