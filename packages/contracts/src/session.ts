/**
 * Session Manager contracts.
 *
 * Governance: docs/architecture/KERNEL_CONSTITUTION.md sec 1 (#2).
 *
 * A session is NOT necessarily a conversation. It is a bounded span of related
 * activity with a type, participants, nodes, and lifecycle. Designed for
 * future cross-device continuation (parent + handoff).
 */

import type { CorrelationId, PrincipalId, Timestamp, Ulid } from './common.ts';

export type SessionType =
  | 'user_interaction' // a span of direct user<->JARVIS activity
  | 'conversational' // a dialogue thread (a kind of user_interaction)
  | 'workspace' // work centred on a workspace/project
  | 'rtc' // a realtime audio/video session (FUTURE transport; state modelled now)
  | 'device' // a device's attachment span
  | 'objective' // work driven by an objective, no user required
  | 'agent_execution'; // one agent lease's span

export type SessionState =
  | 'starting'
  | 'active'
  | 'idle'
  | 'suspended'
  | 'handoff_pending'
  | 'ended';

export interface Session {
  id: Ulid;
  type: SessionType;
  principalId: PrincipalId;

  /** Node ids currently participating in this session. */
  nodes: string[];

  state: SessionState;
  startedAt: Timestamp;
  endedAt?: Timestamp;
  lastActivityAt: Timestamp;

  /** The correlation id that opened this session, for audit linkage. */
  openedByCorrelationId: CorrelationId;

  /** Parent session for nested / derived spans (e.g. agent_execution under objective). */
  parentSessionId?: Ulid;

  /** Set while state = "handoff_pending". */
  handoff?: SessionHandoff;

  /** Opaque per-type context reference (e.g. workspace id, objective id). */
  contextRef?: string;

  /** Optimistic-concurrency version. */
  version: number;
}

export interface SessionHandoff {
  /** Node the session is being moved to. */
  toNodeId: string;
  initiatedAt: Timestamp;
  /** Continuation token the target node presents to resume. */
  continuationToken: string;
  reason: string;
}

export interface OpenSessionRequest {
  type: SessionType;
  principalId: PrincipalId;
  nodeId: string;
  correlationId: CorrelationId;
  parentSessionId?: Ulid;
  contextRef?: string;
}

export interface SessionTransitionRequest {
  sessionId: Ulid;
  to: SessionState;
  reason: string;
  /** Required when to = "handoff_pending". */
  handoff?: Omit<SessionHandoff, 'initiatedAt'>;
  /** Optimistic-concurrency guard. */
  expectedVersion: number;
}

/** Legal session state transitions. */
export const LEGAL_SESSION_TRANSITIONS: Readonly<
  Record<SessionState, readonly SessionState[]>
> = {
  starting: ['active', 'ended'],
  active: ['idle', 'suspended', 'handoff_pending', 'ended'],
  idle: ['active', 'suspended', 'ended'],
  suspended: ['active', 'ended'],
  handoff_pending: ['active', 'ended'],
  ended: [],
} as const;
