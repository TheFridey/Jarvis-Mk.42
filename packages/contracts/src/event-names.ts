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
  CognitionStarted: 'jarvis.cognition.run.started',
  CognitionCompleted: 'jarvis.cognition.run.completed',
  CognitionRejected: 'jarvis.cognition.run.rejected',
  CognitionAgentInvoked: 'jarvis.cognition.agent.invoked',
  CognitionModelSelected: 'jarvis.cognition.model.selected',
  CognitionProposalCreated: 'jarvis.cognition.proposal.created',
  CognitionEvidenceReturned: 'jarvis.cognition.evidence.returned',
  CognitionOutputValidated: 'jarvis.cognition.output.validated',
  CognitionResultDelivered: 'jarvis.cognition.result.delivered',
  VoiceActivated: 'jarvis.perception.audio.activated',
  VoicePartial: 'jarvis.perception.audio.asr.partial',
  VoiceTranscript: 'jarvis.perception.audio.asr.transcript',
  VoiceBargeIn: 'jarvis.perception.audio.barge_in',
  VoiceSilence: 'jarvis.perception.audio.silence',
  VoiceDeviceChanged: 'jarvis.perception.audio.device_changed',
  VoiceDeviceLost: 'jarvis.perception.audio.lost',
  VisionAirTouch: 'jarvis.perception.hands.air_touch',
  VisionPresence: 'jarvis.perception.vision.person_present',
  VisionScreenContext: 'jarvis.perception.screen.context',
  VisionCameraLost: 'jarvis.perception.vision.camera_lost',
  VisionCameraRestored: 'jarvis.perception.vision.camera_restored',
  ObjectiveCreated: 'jarvis.cognition.objective.created',
  ObjectiveTransitioned: 'jarvis.cognition.objective.transitioned',

  // --- Kernel: lifecycle ---
  KernelStarting: 'jarvis.kernel.lifecycle.starting',
  KernelOperational: 'jarvis.kernel.lifecycle.operational',
  KernelStopping: 'jarvis.kernel.lifecycle.stopping',
  KernelDegraded: 'jarvis.kernel.lifecycle.degraded',

  // --- Infra: nodes ---
  NodeConnected: 'jarvis.infra.node.connected',
  NodeHeartbeat: 'jarvis.infra.node.heartbeat',
  NodeDegraded: 'jarvis.infra.node.degraded',
  NodeDisconnected: 'jarvis.infra.node.disconnected',
  NodeRevoked: 'jarvis.infra.node.revoked',
  NodeIsolated: 'jarvis.infra.node.isolated',

  // --- Event fabric self-observations ---
  EventRejected: 'jarvis.kernel.event.rejected',
  EventDeadLettered: 'jarvis.kernel.event.dead_lettered',

  // --- World (ATLAS beliefs) — MK.46 ---
  WorldEntityUpserted: 'jarvis.world.entity.upserted',
  WorldRelationshipAsserted: 'jarvis.world.relationship.asserted',
  WorldFactAsserted: 'jarvis.world.fact.asserted',
  WorldFactSuperseded: 'jarvis.world.fact.superseded',
  WorldFactExpired: 'jarvis.world.fact.expired',
  WorldConflictRecorded: 'jarvis.world.conflict.recorded',
  WorldConflictResolved: 'jarvis.world.conflict.resolved',
  WorldEntityMerged: 'jarvis.world.entity.merged',
  WorldObservationRecorded: 'jarvis.world.observation.recorded',
  WorldObservationPromoted: 'jarvis.world.observation.promoted',
  WorldForgotten: 'jarvis.world.record.forgotten',
  WorldCausalHypothesised: 'jarvis.world.causal.hypothesised',

  // --- Memory (MNEMOSYNE experience) — MK.46 ---
  MemoryEpisodeRecorded: 'jarvis.memory.episode.recorded',
  MemorySemanticLearned: 'jarvis.memory.semantic.learned',
  MemoryProcedureUpdated: 'jarvis.memory.procedure.updated',
  MemoryPreferenceRecorded: 'jarvis.memory.preference.recorded',
  MemoryCandidateScored: 'jarvis.memory.candidate.scored',
  MemoryCandidateDisposed: 'jarvis.memory.candidate.disposed',
  MemoryConsolidationCompleted: 'jarvis.memory.consolidation.completed',
  MemoryInsightAvailable: 'jarvis.memory.insight.available',
  MemoryForgotten: 'jarvis.memory.record.forgotten',

  CapabilityRegistered: 'jarvis.agency.capability.registered',
  CapabilityDeprecated: 'jarvis.agency.capability.deprecated',
  InvocationProposed: 'jarvis.agency.invocation.proposed',
  InvocationValidated: 'jarvis.agency.invocation.validated',
  InvocationRejected: 'jarvis.agency.invocation.rejected',
  InvocationPolicyChecked: 'jarvis.agency.invocation.policy_checked',
  InvocationDenied: 'jarvis.agency.invocation.denied',
  InvocationAwaitingApproval: 'jarvis.agency.invocation.awaiting_approval',
  InvocationApproved: 'jarvis.agency.invocation.approved',
  InvocationApprovalExpired: 'jarvis.agency.invocation.approval_expired',
  InvocationSimulated: 'jarvis.agency.invocation.simulated',
  InvocationStarted: 'jarvis.agency.invocation.started',
  InvocationAborted: 'jarvis.agency.invocation.aborted',
  InvocationStepCompleted: 'jarvis.agency.invocation.step_completed',
  InvocationVerified: 'jarvis.agency.invocation.verified',
  InvocationVerificationFailed: 'jarvis.agency.invocation.verification_failed',
  InvocationFailed: 'jarvis.agency.invocation.failed',
  InvocationRolledBack: 'jarvis.agency.invocation.rolled_back',
  InvocationCompensated: 'jarvis.agency.invocation.compensated',
  InvocationPartiallyCompleted: 'jarvis.agency.invocation.partially_completed',
  GrantIssued: 'jarvis.agency.grant.issued',
  GrantRevoked: 'jarvis.agency.grant.revoked',
  GrantModified: 'jarvis.agency.grant.modified',
  LeaseAcquired: 'jarvis.agency.lease.acquired',
  LeaseReleased: 'jarvis.agency.lease.released',
  LeaseBroken: 'jarvis.agency.lease.broken',
  CapabilityGap: 'jarvis.agency.capability_gap',
  CapabilityProbationEntered: 'jarvis.agency.capability.probation.entered',
  CapabilityProbationCleared: 'jarvis.agency.capability.probation.cleared',
  LabsRunStarted: 'jarvis.agency.labs.run_started',
  LabsRunFinished: 'jarvis.agency.labs.run_finished',
  CredentialMinted: 'jarvis.security.credential.minted',
  SecurityAlertLow: 'jarvis.security.alert.low',
  SecurityAlertElevated: 'jarvis.security.alert.elevated',
  SecurityAlertHigh: 'jarvis.security.alert.high',
  SecurityAlertCritical: 'jarvis.security.alert.critical',
  GuardianEntered: 'jarvis.security.guardian.entered',
  GuardianStepCompleted: 'jarvis.security.guardian.step_completed',
  GuardianCleared: 'jarvis.security.guardian.cleared',
} as const;

export type EventName = (typeof EventNames)[keyof typeof EventNames];
