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
};

/** Returns the schema for a type+version, or a permissive fallback. */
export function payloadSchemaFor(type: string, schemaVersion: number): z.ZodTypeAny {
  return payloadSchemas[type]?.[schemaVersion] ?? z.unknown();
}

/** True when we have an explicit schema (used to distinguish "unknown type"). */
export function hasPayloadSchema(type: string, schemaVersion: number): boolean {
  return Boolean(payloadSchemas[type]?.[schemaVersion]);
}
