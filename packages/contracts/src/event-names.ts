/**
 * Canonical event type names for the Nervous System (EVENT_ARCHITECTURE.md sec 3).
 *
 * Grammar: jarvis.<plane>.<domain>.<name>. These constants are the single
 * source of truth; producers and consumers import from here, never string
 * literals.
 */

export const EventNames = {
  // --- Kernel: state ---
  StateMutated: 'jarvis.kernel.state.mutated',
  StateSnapshotTaken: 'jarvis.kernel.state.snapshot_taken',

  // --- Kernel: mode ---
  ModeChanged: 'jarvis.kernel.mode.changed',

  // --- Kernel: identity ---
  IdentityAuthenticated: 'jarvis.kernel.identity.authenticated',
  IdentityAuthFailed: 'jarvis.kernel.identity.auth_failed',
  IdentityRevoked: 'jarvis.kernel.identity.revoked',

  // --- Kernel: session ---
  SessionStarted: 'jarvis.kernel.session.started',
  SessionTransitioned: 'jarvis.kernel.session.transitioned',
  SessionEnded: 'jarvis.kernel.session.ended',

  // --- Kernel: presence ---
  PresenceChanged: 'jarvis.kernel.presence.changed',

  // --- Kernel: health ---
  HealthTransitioned: 'jarvis.kernel.health.transitioned',

  // --- Kernel: scheduler ---
  SchedulerTick: 'jarvis.kernel.scheduler.tick',

  // --- Kernel: notification ---
  NotificationRaised: 'jarvis.kernel.notification.raised',

  // --- Kernel: context ---
  ContextCompiled: 'jarvis.kernel.context.compiled',

  // --- Kernel: lifecycle ---
  KernelStarting: 'jarvis.kernel.lifecycle.starting',
  KernelOperational: 'jarvis.kernel.lifecycle.operational',
  KernelStopping: 'jarvis.kernel.lifecycle.stopping',
  KernelDegraded: 'jarvis.kernel.lifecycle.degraded',

  // --- Infra: nodes ---
  NodeConnected: 'jarvis.infra.node.connected',
  NodeDisconnected: 'jarvis.infra.node.disconnected',

  // --- Event fabric self-observations ---
  EventRejected: 'jarvis.kernel.event.rejected',
  EventDeadLettered: 'jarvis.kernel.event.dead_lettered',

  // --- World (ATLAS beliefs) — MK.46 ---
  WorldFactAsserted: 'jarvis.world.fact.asserted',
  WorldFactSuperseded: 'jarvis.world.fact.superseded',
  WorldConflictRecorded: 'jarvis.world.conflict.recorded',
  WorldEntityMerged: 'jarvis.world.entity.merged',
  WorldForgotten: 'jarvis.world.record.forgotten',
  WorldCausalHypothesised: 'jarvis.world.causal.hypothesised',

  // --- Memory (MNEMOSYNE experience) — MK.46 ---
  MemoryEpisodeRecorded: 'jarvis.memory.episode.recorded',
  MemoryCandidateScored: 'jarvis.memory.candidate.scored',
  MemoryCandidateDisposed: 'jarvis.memory.candidate.disposed',
  MemoryConsolidationCompleted: 'jarvis.memory.consolidation.completed',
  MemoryInsightAvailable: 'jarvis.memory.insight.available',
  MemoryForgotten: 'jarvis.memory.record.forgotten',
} as const;

export type EventName = (typeof EventNames)[keyof typeof EventNames];
