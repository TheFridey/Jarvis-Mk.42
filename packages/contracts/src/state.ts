/**
 * Authoritative State Manager contracts (L5, L6, ADR-0017).
 *
 * ONE authoritative logical state, held as a set of independently versioned
 * slices. Clients SUBSCRIBE to slices and REQUEST mutations; they never become
 * the authority. Every accepted mutation emits `jarvis.kernel.state.mutated`
 * and bumps both the slice version and the monotonic global `stateVersion`.
 */

import type { CorrelationId, Timestamp, Ulid } from './common.ts';
import type { EventActor } from './event.ts';
import type { JarvisMode } from './mode.ts';
import type { PresenceState } from './presence.ts';
import type { HealthStatus } from './health.ts';

/**
 * The canonical set of authoritative state slices for the Nervous System.
 * Extending this list is additive; each key has exactly one writer path.
 */
export type StateSliceKey =
  | 'active_principal'
  | 'mode'
  | 'presence'
  | 'location'
  | 'active_session'
  | 'active_context'
  | 'active_objective'
  | 'active_workspace'
  | 'selected_object'
  | 'cursor_target'
  | 'gesture_target'
  | 'gaze_target' // FUTURE - populated by a later perception phase
  | 'running_tasks'
  | 'running_agents'
  | 'connected_nodes'
  | 'active_alerts'
  | 'rtc_state' // FUTURE transport - state slot modelled now
  | 'perception_state'
  | 'degradation_state';

export interface StateSlice<T = unknown> {
  key: StateSliceKey;
  value: T;
  /** Optimistic-concurrency version, starts at 0, +1 per accepted mutation. */
  version: number;
  updatedAt: Timestamp;
  /** The event id whose projection last wrote this slice. */
  lastEventId: Ulid | null;
  updatedByCorrelationId: CorrelationId | null;
}

/** Strongly-typed values for the well-known slices. */
export interface KnownSliceValues {
  active_principal: { principalId: string | null };
  mode: { mode: JarvisMode };
  presence: { state: PresenceState; confidence: number };
  location: { spaceId: string | null; ref?: string };
  active_session: { sessionId: string | null };
  active_context: { contextId: string | null; version: number | null };
  active_objective: { objectiveId: string | null };
  active_workspace: { workspaceId: string | null };
  selected_object: { ref: string | null };
  cursor_target: { ref: string | null };
  gesture_target: { ref: string | null };
  gaze_target: { ref: string | null };
  running_tasks: { taskIds: string[] };
  running_agents: { agentRunIds: string[] };
  connected_nodes: { nodeIds: string[] };
  active_alerts: { alertIds: string[] };
  rtc_state: { sessionId: string | null; status: 'idle' | 'connecting' | 'live' };
  perception_state: {
    streams: Record<string, 'active' | 'lost' | 'unavailable' | 'idle'>;
  };
  degradation_state: {
    level: 'nominal' | 'degraded' | 'critical';
    criticalIssues: string[];
    overallHealth: HealthStatus;
  };
}

export interface SystemStateView {
  /** Monotonic across the whole authoritative state. */
  stateVersion: number;
  generatedAt: Timestamp;
  slices: { [K in StateSliceKey]: StateSlice };
}

/**
 * A client's request to change one slice. `expectedVersion` enforces optimistic
 * concurrency: if it does not match the current slice version the mutation is
 * rejected with `version_conflict` (STATE_MODEL.md sec 5).
 */
export interface MutationRequest<T = unknown> {
  key: StateSliceKey;
  /** Full replacement value for the slice. */
  value: T;
  /** Current version the client believes the slice is at. Use -1 to force. */
  expectedVersion: number;
  correlationId: CorrelationId;
  actor: EventActor;
  reason: string;
}

export type MutationResult =
  | {
      ok: true;
      key: StateSliceKey;
      newVersion: number;
      stateVersion: number;
      eventId: Ulid;
    }
  | {
      ok: false;
      key: StateSliceKey;
      code: MutationRejectionCode;
      detail: string;
      /** Present for version_conflict so the client can retry. */
      currentVersion?: number;
    };

export type MutationRejectionCode =
  | 'version_conflict'
  | 'unknown_slice'
  | 'validation_failed'
  | 'forbidden_slice' // slice not client-writable (e.g. degradation_state)
  | 'shutting_down';

/** An update pushed to a subscriber. */
export interface StateUpdate {
  key: StateSliceKey;
  slice: StateSlice;
  stateVersion: number;
  /** The mutation event id that caused this update. */
  eventId: Ulid;
}

/** A point-in-time full snapshot used for recovery and client bootstrap. */
export interface StateSnapshot {
  stateVersion: number;
  takenAt: Timestamp;
  /** Highest event id folded into this snapshot (the replay checkpoint). */
  checkpointEventId: Ulid | null;
  slices: { [K in StateSliceKey]: StateSlice };
}
