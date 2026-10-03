/**
 * Notification Manager contracts.
 *
 * Governance: docs/architecture/KERNEL_CONSTITUTION.md sec 1 (#14).
 *
 * NO subsystem may interrupt the principal directly. Every user-directed alert
 * passes through here and is gated by severity, urgency, mode, presence,
 * interruption policy, and dedup.
 */

import type { PrincipalId, Timestamp, Ulid } from './common.ts';
import type { JarvisMode } from './mode.ts';

export type NotificationSeverity = 'info' | 'notice' | 'warning' | 'critical';
export type NotificationUrgency = 'deferrable' | 'normal' | 'urgent' | 'immediate';

export type NotificationDisposition =
  | 'delivered' // passed the gate, surfaced now
  | 'batched' // held for later summary (mode/presence suppression)
  | 'suppressed' // dropped by policy (e.g. duplicate, mode forbids)
  | 'queued'; // no surface available; will retry

export interface NotificationRequest {
  minimumSurfaceTrust?: import('./capability.ts').NodeTrustTier;
  /** Emitting subsystem id. */
  source: string;
  principalId: PrincipalId;
  severity: NotificationSeverity;
  urgency: NotificationUrgency;
  title: string;
  body: string;
  /** Dedup key: identical keys within the window collapse. */
  dedupeKey: string;
  /** Correlation for audit linkage. */
  correlationId: string;
  /** Optional structured payload for a surface to render richly. */
  data?: Record<string, unknown>;
}

export interface NotificationRecord {
  deliverySurfaceId?:string;
  id: Ulid;
  request: NotificationRequest;
  disposition: NotificationDisposition;
  decidedAt: Timestamp;
  /** Why the gate produced this disposition. */
  rationale: string;
  /** When batched: the batch it joined. */
  batchId?: string;
}

/**
 * Per-mode minimum bar. A request whose (severity, urgency) does not clear the
 * bar for the current mode is batched or suppressed. GUARDIAN and DEGRADED are
 * deliberately permissive for warnings/critical, restrictive for info.
 */
export interface InterruptionPolicy {
  /** Minimum severity that may be delivered immediately, per mode. */
  minSeverityByMode: Record<JarvisMode, NotificationSeverity>;
  /** Minimum urgency that may interrupt while presence is FOCUSED. */
  minUrgencyWhenUserFocused: NotificationUrgency;
  /** Dedupe window. */
  dedupeWindowMs: number;
}

/** Payload of `jarvis.kernel.notification.raised`. */
export interface NotificationRaisedPayload {
  deliverySurfaceId?:string;
  notificationId: string;
  source: string;
  severity: NotificationSeverity;
  urgency: NotificationUrgency;
  disposition: NotificationDisposition;
  rationale: string;
}
