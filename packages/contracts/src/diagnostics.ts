/**
 * Diagnostics API contract.
 *
 * Governance: docs/architecture/KERNEL_CONSTITUTION.md sec 1 (#15),
 *             the MK.43 "Nervous System" spec.
 *
 * Read-only. This is the structured answer behind "I am operational."
 * Placeholder subsystems are marked `placeholder: true`, never faked as healthy.
 */

import type { Timestamp } from './common.ts';
import type { JarvisMode } from './mode.ts';
import type { HealthReport, HealthStatus } from './health.ts';
import type { VisionDiagnostics } from './vision.ts';

export interface DependencyState {
  name: string;
  status: HealthStatus;
  placeholder: boolean;
  detail?: Record<string, unknown>;
}

export interface DiagnosticsReport {
  ok: boolean;
  generatedAt: Timestamp;

  identity: {
    nodeId: string;
    instanceId: string;
    version: string;
  };

  mode: JarvisMode;
  uptimeSeconds: number;

  events: {
    /** Events appended in the last 60s. */
    ratePerMinute: number;
    totalAppended: number;
    outboxPending: number;
    /** Lifetime total. History: it does not, on its own, describe current health. */
    deadLettered: number;
    /** Dead letters recorded since this process started. This is what `ok` uses. */
    deadLetteredSinceStart: number;
    /**
     * Durable incidents still without a resolution. The dead-letter schema records no
     * acknowledgement, replay or resolution state, so no recorded dead letter can be
     * proven resolved: this currently equals the lifetime total. It is reported so a
     * restart cannot make the backlog invisible, and it is deliberately not part of `ok`
     * — a health endpoint must not depend on a permanent historical backlog, but the
     * backlog must still be visible to an operator.
     */
    deadLetteredUnresolved: number;
  };

  eventFabric?: {
    phase: 'HEALTHY' | 'RECONNECTING' | 'SUSTAINED_OUTAGE' | 'RECOVERING';
    degradeAfterMs: number;
    outageStartedAt: Timestamp | null;
    graceDeadlineAt: Timestamp | null;
    lastConnectedAt: Timestamp | null;
    lastVerifiedAt: Timestamp | null;
    lastRelaySuccessAt: Timestamp | null;
    lastError: string | null;
    waitingForRelayEvidence: boolean;
  };

  state: {
    stateVersion: number;
    lastMutationAt: Timestamp | null;
    snapshotCheckpointEventId: string | null;
  };

  sessions: {
    active: number;
    byType: Record<string, number>;
  };

  objectives: {
    /** Durable objectives currently in an actionable state. */
    active: number;
    placeholder: boolean;
  };

  nodes: {
    connected: number;
    ids: string[];
  };

  dependencies: DependencyState[];

  health: HealthReport;

  alerts: {
    active: number;
    items: Array<{ id: string; severity: string; title: string; since: Timestamp }>;
  };
  vision?: VisionDiagnostics;
  telemetry?: { enabled:boolean; started:boolean; endpoint?:string; lastExportAt?:Timestamp; lastError?:string };
}
