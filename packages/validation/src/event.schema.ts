/**
 * Runtime schema for the Event envelope (docs/protocols/event-envelope.md).
 * The Event Manager validates every draft against this at append time;
 * structurally-invalid events never enter the store or the bus.
 */
import { z } from 'zod';

export const ulidSchema = z
  .string()
  .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'must be a Crockford ULID');

export const timestampSchema = z.string().datetime({ offset: true });

export const retentionClassSchema = z.enum([
  'TRANSIENT',
  'OPERATIONAL',
  'AUDIT',
  'MEMORY_CANDIDATE',
  'SECURITY',
  'DIAGNOSTIC',
]);

export const privacyClassSchema = z.enum([
  'PUBLIC',
  'INTERNAL',
  'SENSITIVE',
  'RESTRICTED',
]);

export const provenanceSchema = z.object({
  method: z.enum([
    'sensor',
    'model',
    'retrieval',
    'inference',
    'assertion',
    'derivation',
    'system',
  ]),
  producedBy: z.string().min(1),
  producedOn: z.string().min(1),
  producedAt: timestampSchema,
  model: z.object({ id: z.string(), version: z.string() }).optional(),
  sourceRefs: z.array(z.string()).optional(),
  correlationId: z.string().min(1),
  derivedFromUntrusted: z.boolean(),
});

export const eventActorSchema = z.object({
  kind: z.enum(['principal', 'agent', 'system', 'node']),
  id: z.string().min(1),
  onBehalfOf: z.string().min(1).optional(),
});

export const eventSubjectSchema = z.object({
  kind: z.string().min(1),
  id: z.string().min(1),
});

export const eventSourceSchema = z.object({
  node: z.string().min(1),
  component: z.string().min(1),
});

/** The full persisted envelope. */
export const eventSchema = z.object({
  id: ulidSchema,
  type: z
    .string()
    .regex(
      /^jarvis\.[a-z]+\.[a-z0-9_]+(\.[a-z0-9_]+)+$/,
      'type must be jarvis.<plane>.<domain>.<name>',
    ),
  schemaVersion: z.number().int().min(1),
  retentionClass: retentionClassSchema,
  time: timestampSchema,
  recordedAt: timestampSchema,
  source: eventSourceSchema,
  subject: eventSubjectSchema,
  actor: eventActorSchema,
  provenance: provenanceSchema,
  causationId: z.string().min(1),
  correlationId: z.string().min(1),
  principalId: z.string().min(1),
  domainId: z.string().min(1).optional(),
  privacyClass: privacyClassSchema,
  traceId: z.string().optional(),
  location: z.object({ spaceId: z.string(), ref: z.string().optional() }).optional(),
  confidence: z.number().min(0).max(1).optional(),
  evidence: z.array(z.string()).optional(),
  expiresAt: timestampSchema.optional(),
  payload: z.unknown(),
  meta: z.record(z.string()).optional(),
});

/** A draft: no id/recordedAt required (Event Manager fills them). */
export const eventDraftSchema = eventSchema
  .omit({ id: true, recordedAt: true })
  .extend({ id: ulidSchema.optional() });

export type EventShape = z.infer<typeof eventSchema>;
export type EventDraftShape = z.infer<typeof eventDraftSchema>;
