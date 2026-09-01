/**
 * The Event envelope - the atom of the system (L4).
 *
 * Normative prose: docs/protocols/event-envelope.md
 * Governance:      docs/architecture/EVENT_ARCHITECTURE.md + ADR-0009 (Amendment 1)
 *
 * Per-subject ordering is guaranteed; global ordering is not. Every consumer is
 * idempotent on `id`. Malformed payloads are rejected at append time and never
 * enter the store. TRANSIENT events are never persisted.
 */

import type {
  CausationId,
  CorrelationId,
  Plane,
  PrincipalId,
  Timestamp,
  Ulid,
} from './common.ts';
import type { Provenance } from './provenance.ts';

/**
 * Storage policy, fixed at append time (ADR-0009 Amendment 1,
 * EVENT_ARCHITECTURE.md sec 2.1). Immutable after append - to keep a TRANSIENT
 * signal, a consumer re-emits an elevated event.
 */
export type RetentionClass =
  | 'TRANSIENT' // bus only, not persisted (high-frequency perception)
  | 'OPERATIONAL' // 90 days (state/session/mode/health changes)
  | 'AUDIT' // indefinite, tamper-evident (policy/grants/executions)
  | 'MEMORY_CANDIDATE' // until consolidated, else 30 days
  | 'SECURITY' // indefinite, tamper-evident (auth/denials/GUARDIAN)
  | 'DIAGNOSTIC'; // 14 days (context.compiled, scheduler ticks)

/** Confidentiality band on every event. Drives Context Compiler filtering. */
export type PrivacyClass = 'PUBLIC' | 'INTERNAL' | 'SENSITIVE' | 'RESTRICTED';

export type ActorKind = 'principal' | 'agent' | 'system' | 'node';

export interface EventActor {
  kind: ActorKind;
  id: string;
  /** principalId when kind = "agent" (agents always act for a principal). */
  onBehalfOf?: PrincipalId;
}

export interface EventSubject {
  /** Aggregate type this event is ordered within, e.g. "objective", "session". */
  kind: string;
  id: string;
}

export interface EventSource {
  node: string;
  component: string;
}

export interface EventLocation {
  spaceId: string;
  ref?: string;
}

/**
 * `type` grammar: `jarvis.<plane>.<domain>.<name>` - lower-case, dot-delimited,
 * stable. A rename is a new type, never an in-place change.
 */
export interface Event<TPayload = unknown> {
  id: Ulid;
  type: string;
  schemaVersion: number;
  retentionClass: RetentionClass;

  time: Timestamp; // occurred-at (producer clock)
  recordedAt: Timestamp; // persisted-at (Kernel clock)

  source: EventSource;
  subject: EventSubject;
  actor: EventActor;

  provenance: Provenance;
  causationId: CausationId;
  correlationId: CorrelationId;
  principalId: PrincipalId;
  privacyClass: PrivacyClass;

  traceId?: string;
  location?: EventLocation;
  confidence?: number;
  evidence?: string[];
  expiresAt?: Timestamp;

  payload: TPayload;

  /** Non-authoritative hints only (`replay`, ...). Never acted on as data. */
  meta?: Record<string, string>;
}

/** Helper for referring to a plane segment when building `type` strings. */
export type EventTypeFor<P extends Plane> = `jarvis.${P}.${string}.${string}`;

/**
 * A Command is a request to change state or cause an effect. It is NOT
 * authoritative until it produces events. Carries a client-generated id for
 * dedupe (EVENT_ARCHITECTURE.md sec 5).
 */
export interface Command<TInput = unknown> {
  commandId: Ulid;
  type: string;
  input: TInput;
  actor: EventActor;
  principalId: PrincipalId;
  /** Minted by the ingress component if this starts a new interaction. */
  correlationId: CorrelationId;
  issuedAt: Timestamp;
}

/**
 * A draft event: everything a producer supplies. The Event Manager fills
 * `id`, `recordedAt`, and validates before it becomes a persisted `Event`.
 */
export type EventDraft<TPayload = unknown> = Omit<
  Event<TPayload>,
  'id' | 'recordedAt'
> & { id?: Ulid };
