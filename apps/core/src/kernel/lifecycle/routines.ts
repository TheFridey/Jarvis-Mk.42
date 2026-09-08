/**
 * The Kernel's internal scheduled routines (Scheduler is WHEN, these are WHAT).
 * All are idempotent and safe to skip. None is coupled to an external user task.
 */
import type { ScheduleDefinition } from '@jarvis/contracts';

export const ROUTINE_DEFS: Record<string, ScheduleDefinition> = {
  healthSelfCheck: {
    id: 'health.self_check',
    kind: 'interval',
    spec: 10_000,
    singleton: true,
    maxRetries: 1,
    retryBackoffMs: 1000,
    pausedWhenDegraded: false, // must keep running to detect recovery
    enabled: true,
  },
  stateSnapshot: {
    id: 'state.snapshot',
    kind: 'interval',
    spec: 60_000,
    singleton: true,
    maxRetries: 2,
    retryBackoffMs: 2000,
    pausedWhenDegraded: false,
    enabled: true,
  },
  retentionSweep: {
    id: 'retention.sweep',
    kind: 'interval',
    spec: 3_600_000,
    singleton: true,
    maxRetries: 1,
    retryBackoffMs: 5000,
    pausedWhenDegraded: true,
    enabled: true,
  },
  notificationBatchFlush: {
    id: 'notification.batch_flush',
    kind: 'interval',
    spec: 120_000,
    singleton: true,
    maxRetries: 1,
    retryBackoffMs: 1000,
    pausedWhenDegraded: false,
    enabled: true,
  },
  objectiveReeval: {
    // PLACEHOLDER routine - the Objective Engine arrives in a later phase.
    // It runs and does nothing but prove the wiring + cadence.
    id: 'objective.reeval',
    kind: 'interval',
    spec: 300_000,
    singleton: true,
    maxRetries: 0,
    retryBackoffMs: 0,
    pausedWhenDegraded: true,
    enabled: true,
  },
  nodeLivenessSweep: {
    // Node Protocol v1 liveness: mark connected nodes whose heartbeat has
    // lapsed as disconnected and emit jarvis.infra.node.disconnected.
    id: 'node.liveness_sweep',
    kind: 'interval',
    spec: 15_000,
    singleton: true,
    maxRetries: 1,
    retryBackoffMs: 2000,
    pausedWhenDegraded: false, // liveness must keep running while degraded
    enabled: true,
  },
  knowledgeHarvest: {
    // MK.46: harvest MNEMOSYNE candidates from eligible events + run the ATLAS
    // observation->fact promotion evaluator + expire stale observations.
    id: 'knowledge.harvest',
    kind: 'interval',
    spec: 120_000,
    singleton: true,
    maxRetries: 1,
    retryBackoffMs: 2000,
    pausedWhenDegraded: true,
    enabled: true,
  },
  memoryConsolidate: {
    // MK.46: DREAMING (ADR-0022). Off-peak knowledge consolidation — merge
    // duplicates, extract semantic memory, decay stale assumptions, surface
    // evidence-backed insights. Deterministic rules only; proposals-only.
    id: 'memory.consolidate',
    kind: 'interval',
    spec: 6 * 3_600_000,
    singleton: true,
    maxRetries: 1,
    retryBackoffMs: 10_000,
    pausedWhenDegraded: true,
    enabled: true,
  },
};
