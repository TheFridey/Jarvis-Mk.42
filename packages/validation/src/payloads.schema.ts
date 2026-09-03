/**
 * Per-`type` payload schemas. The Event Manager looks up the schema for an
 * event's `type` + `schemaVersion` and rejects the event if the payload fails
 * (EVENT_ARCHITECTURE.md sec 9). Unknown types are allowed through with a
 * permissive payload (a consumer may still quarantine them) so the fabric
 * never blocks a legitimately new event type.
 */
import { z } from 'zod';
import { EventNames } from '@jarvis/contracts';

const jarvisModeSchema = z.enum([
  'DORMANT',
  'AMBIENT',
  'ENGAGED',
  'FOCUSED',
  'AUTONOMOUS',
  'GUARDIAN',
  'DEGRADED',
]);

const healthStatusSchema = z.enum([
  'STARTING',
  'HEALTHY',
  'DEGRADED',
  'OFFLINE',
  'RECOVERING',
]);

const invocationSchema = z.object({ invocationId: z.string() });
const capabilitySchema = z.object({ capabilityId: z.string(), version: z.string() });
const grantSchema = z.object({ grantId: z.string(), principalId: z.string(), version: z.number().int() });
const leaseSchema = z.object({ resourceKey: z.string(), invocationId: z.string() });
const findingSchema = z.object({ detector: z.string(), finding: z.record(z.unknown()), corroboration: z.number().int().min(0) });

export const payloadSchemas: Record<string, Record<number, z.ZodTypeAny>> = {
  [EventNames.StateMutated]: {
    1: z.object({
      key: z.string(),
      // Full new slice value - lets a projector rebuild the slice from events
      // alone (STATE_MODEL.md sec 3).
      value: z.unknown(),
      newVersion: z.number().int().min(0),
      stateVersion: z.number().int().min(0),
      reason: z.string(),
      valueHash: z.string(),
      actorKind: z.string(),
    }),
  },
  [EventNames.StateSnapshotTaken]: {
    1: z.object({
      stateVersion: z.number().int().min(0),
      checkpointEventId: z.string().nullable(),
    }),
  },
  [EventNames.ModeChanged]: {
    1: z.object({
      from: jarvisModeSchema,
      to: jarvisModeSchema,
      trigger: z.string(),
      reason: z.string(),
      version: z.number().int().min(0),
    }),
  },
  [EventNames.IdentityAuthenticated]: {
    1: z.object({
      identityId: z.string(),
      principalId: z.string(),
      kind: z.enum(['principal', 'device', 'node', 'service']),
      method: z.string(),
      trust: z.enum(['untrusted', 'provisional', 'trusted', 'verified']),
      nodeId: z.string(),
    }),
  },
  [EventNames.IdentityAuthFailed]: {
    1: z.object({
      method: z.string(),
      code: z.string(),
      nodeId: z.string(),
      claimedPrincipalId: z.string().optional(),
    }),
  },
  [EventNames.IdentityRevoked]: {
    1: z.object({ identityId: z.string(), reason: z.string() }),
  },
  [EventNames.SessionStarted]: {
    1: z.object({
      sessionId: z.string(),
      type: z.string(),
      principalId: z.string(),
      nodeId: z.string(),
      parentSessionId: z.string().optional(),
    }),
  },
  [EventNames.SessionTransitioned]: {
    1: z.object({
      sessionId: z.string(),
      from: z.string(),
      to: z.string(),
      reason: z.string(),
      version: z.number().int().min(0),
    }),
  },
  [EventNames.SessionEnded]: {
    1: z.object({ sessionId: z.string(), reason: z.string() }),
  },
  [EventNames.PresenceChanged]: {
    1: z.object({
      from: z.string(),
      to: z.string(),
      confidence: z.number().min(0).max(1),
      version: z.number().int().min(0),
    }),
  },
  [EventNames.HealthTransitioned]: {
    1: z.object({
      subsystem: z.string(),
      from: healthStatusSchema,
      to: healthStatusSchema,
      message: z.string(),
      overallBefore: healthStatusSchema,
      overallAfter: healthStatusSchema,
    }),
  },
  [EventNames.SchedulerTick]: {
    1: z.object({
      scheduleId: z.string(),
      jobRunId: z.string(),
      status: z.string(),
      attempt: z.number().int().min(0),
      durationMs: z.number().optional(),
    }),
  },
  [EventNames.NotificationRaised]: {
    1: z.object({
      notificationId: z.string(),
      source: z.string(),
      severity: z.string(),
      urgency: z.string(),
      disposition: z.string(),
      rationale: z.string(),
    }),
  },
  [EventNames.ContextCompiled]: {
    1: z.object({
      contextId: z.string(),
      version: z.number().int().min(0),
      intentClass: z.string(),
      itemCount: z.number().int().min(0),
      usedUnits: z.number().int().min(0),
      truncated: z.boolean(),
    }),
  },
  [EventNames.NodeConnected]: {
    1: z.object({ nodeId: z.string(), nodeType: z.string(), trustTier: z.string() }),
  },
  [EventNames.NodeDisconnected]: {
    1: z.object({ nodeId: z.string(), reason: z.string() }),
  },
  [EventNames.KernelStarting]: { 1: z.object({ instanceId: z.string(), version: z.string() }) },
  [EventNames.KernelOperational]: {
    1: z.object({ instanceId: z.string(), coldStartMs: z.number(), replayedEvents: z.number() }),
  },
  [EventNames.KernelStopping]: { 1: z.object({ instanceId: z.string(), reason: z.string() }) },
  [EventNames.KernelDegraded]: {
    1: z.object({ instanceId: z.string(), criticalIssues: z.array(z.string()) }),
  },
  [EventNames.EventRejected]: {
    1: z.object({ attemptedType: z.string(), reason: z.string() }),
  },
  [EventNames.EventDeadLettered]: {
    1: z.object({ eventId: z.string(), consumer: z.string(), attempts: z.number(), lastError: z.string() }),
  },
  [EventNames.CapabilityRegistered]: { 1: capabilitySchema.extend({ registeredBy: z.string(), artifactHash: z.string() }) },
  [EventNames.CapabilityDeprecated]: { 1: capabilitySchema.extend({ reason: z.string() }) },
  [EventNames.InvocationProposed]: { 1: invocationSchema.extend({ capabilityId: z.string(), version: z.string(), action: z.string(), inputHash: z.string() }) },
  [EventNames.InvocationValidated]: { 1: invocationSchema },
  [EventNames.InvocationRejected]: { 1: invocationSchema.extend({ reason: z.string() }) },
  [EventNames.InvocationPolicyChecked]: { 1: invocationSchema.extend({ verdict: z.enum(['ALLOW', 'DENY', 'REQUIRE_APPROVAL']), firedRuleIds: z.array(z.string()) }) },
  [EventNames.InvocationDenied]: { 1: invocationSchema.extend({ reason: z.string() }) },
  [EventNames.InvocationAwaitingApproval]: { 1: invocationSchema.extend({ approvalRequestId: z.string() }) },
  [EventNames.InvocationApproved]: { 1: invocationSchema.extend({ approvalRequestId: z.string() }) },
  [EventNames.InvocationApprovalExpired]: { 1: invocationSchema.extend({ approvalRequestId: z.string() }) },
  [EventNames.InvocationSimulated]: { 1: invocationSchema.extend({ predictedEffectRef: z.string() }) },
  [EventNames.InvocationStarted]: { 1: invocationSchema.extend({ grantId: z.string(), grantVersion: z.number().int() }) },
  [EventNames.InvocationAborted]: { 1: invocationSchema.extend({ reason: z.string() }) },
  [EventNames.InvocationStepCompleted]: { 1: invocationSchema.extend({ ordinal: z.number().int(), name: z.string() }) },
  [EventNames.InvocationVerified]: { 1: invocationSchema.extend({ verifyReportRef: z.string() }) },
  [EventNames.InvocationVerificationFailed]: { 1: invocationSchema.extend({ verifyReportRef: z.string() }) },
  [EventNames.InvocationFailed]: { 1: invocationSchema.extend({ reason: z.string() }) },
  [EventNames.InvocationRolledBack]: { 1: invocationSchema.extend({ rollbackReportRef: z.string() }) },
  [EventNames.InvocationCompensated]: { 1: invocationSchema.extend({ ordinal: z.number().int() }) },
  [EventNames.InvocationPartiallyCompleted]: { 1: invocationSchema.extend({ residual: z.array(z.string()) }) },
  [EventNames.GrantIssued]: { 1: grantSchema },
  [EventNames.GrantRevoked]: { 1: grantSchema.extend({ reason: z.string() }) },
  [EventNames.GrantModified]: { 1: grantSchema },
  [EventNames.LeaseAcquired]: { 1: leaseSchema.extend({ expiresAt: z.string() }) },
  [EventNames.LeaseReleased]: { 1: leaseSchema },
  [EventNames.LeaseBroken]: { 1: leaseSchema.extend({ reason: z.string() }) },
  [EventNames.CapabilityGap]: { 1: z.object({ intent: z.string(), why: z.string(), exampleInvocations: z.array(z.unknown()) }) },
  [EventNames.CapabilityProbationEntered]: { 1: capabilitySchema },
  [EventNames.CapabilityProbationCleared]: { 1: capabilitySchema.extend({ clearedBy: z.string() }) },
  [EventNames.LabsRunStarted]: { 1: z.object({ runId: z.string(), draftId: z.string() }) },
  [EventNames.LabsRunFinished]: { 1: z.object({ runId: z.string(), draftId: z.string(), verdict: z.enum(['passed', 'failed']), artifactHash: z.string() }) },
  [EventNames.CredentialMinted]: { 1: invocationSchema.extend({ handleId: z.string(), scope: z.record(z.unknown()), mode: z.enum(['dry-run', 'full']), expiresAt: z.string() }) },
  [EventNames.SecurityAlertLow]: { 1: findingSchema },
  [EventNames.SecurityAlertElevated]: { 1: findingSchema },
  [EventNames.SecurityAlertHigh]: { 1: findingSchema },
  [EventNames.SecurityAlertCritical]: { 1: findingSchema },
  [EventNames.GuardianEntered]: { 1: z.object({ findingId: z.string().optional(), enteredAt: z.string() }) },
  [EventNames.GuardianStepCompleted]: { 1: z.object({ step: z.string(), invocationId: z.string(), completedAt: z.string() }) },
  [EventNames.GuardianCleared]: { 1: z.object({ clearedBy: z.string(), clearedAt: z.string() }) },
};

/** Returns the schema for a type+version, or a permissive fallback. */
export function payloadSchemaFor(type: string, schemaVersion: number): z.ZodTypeAny {
  return payloadSchemas[type]?.[schemaVersion] ?? z.unknown();
}

/** True when we have an explicit schema (used to distinguish "unknown type"). */
export function hasPayloadSchema(type: string, schemaVersion: number): boolean {
  return Boolean(payloadSchemas[type]?.[schemaVersion]);
}
