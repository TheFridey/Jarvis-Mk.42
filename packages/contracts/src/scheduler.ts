/**
 * Scheduler contracts.
 *
 * Governance: docs/architecture/KERNEL_CONSTITUTION.md sec 1 (#13).
 *
 * MK.43 scope: INTERNAL routines only (health checks, retention sweeps,
 * snapshot cadence, mode-dwell checks). NOT coupled to external user tasks.
 * Decides WHEN, never WHAT.
 */

import type { Timestamp, Ulid } from './common.ts';

export type ScheduleKind = 'interval' | 'cron' | 'once';

export interface ScheduleDefinition {
  /** Stable id, e.g. "retention.sweep", "state.snapshot". */
  id: string;
  kind: ScheduleKind;
  /** interval: milliseconds; cron: 5-field expression; once: ignored. */
  spec: string | number;
  /** For kind = "once". */
  runAt?: Timestamp;
  /** Skip if the previous run of this id is still executing. */
  singleton: boolean;
  /** Bounded retry on failure. */
  maxRetries: number;
  retryBackoffMs: number;
  /** If true, this routine is paused while mode is DEGRADED or GUARDIAN. */
  pausedWhenDegraded: boolean;
  enabled: boolean;
}

export type JobStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'retrying'
  | 'skipped'
  | 'dead';

export interface JobRun {
  id: Ulid;
  scheduleId: string;
  status: JobStatus;
  attempt: number;
  scheduledFor: Timestamp;
  startedAt?: Timestamp;
  finishedAt?: Timestamp;
  error?: string;
}

/** Payload of `jarvis.kernel.scheduler.tick` (DIAGNOSTIC retention). */
export interface SchedulerTickPayload {
  scheduleId: string;
  jobRunId: string;
  status: JobStatus;
  attempt: number;
  durationMs?: number;
}

/** A registered routine handler. Returns nothing; throws to signal failure. */
export type RoutineHandler = (ctx: RoutineContext) => Promise<void>;

export interface RoutineContext {
  scheduleId: string;
  jobRunId: string;
  attempt: number;
  /** Abort signal fired if the Kernel is shutting down. */
  signal: AbortSignal;
}
