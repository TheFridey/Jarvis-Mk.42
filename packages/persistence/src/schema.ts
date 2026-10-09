/**
 * Drizzle schema for typed reads/writes on the non-partitioned tables.
 * The partitioned `events.events` table is created by raw SQL migrations and
 * accessed through the event store's own queries; a read-only view mapping is
 * provided here for convenience.
 */
import {
  bigint,
  bigserial,
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const eventsSchema = pgSchema('events');
export const projectionsSchema = pgSchema('projections');
export const identitySchema = pgSchema('identity');
export const sessionSchema = pgSchema('session');
export const schedulerSchema = pgSchema('scheduler');

// --- events schema (read view + supporting tables) ---

/** Matches the partitioned events.events table column-for-column. */
export const events = eventsSchema.table('events', {
  id: text('id').primaryKey(),
  globalSeq: bigint('global_seq', { mode: 'bigint' }).notNull(),
  type: text('type').notNull(),
  schemaVersion: integer('schema_version').notNull(),
  retentionClass: text('retention_class').notNull(),
  time: timestamp('time', { withTimezone: true }).notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
  sourceNode: text('source_node').notNull(),
  sourceComponent: text('source_component').notNull(),
  subjectKind: text('subject_kind').notNull(),
  subjectId: text('subject_id').notNull(),
  actorKind: text('actor_kind').notNull(),
  actorId: text('actor_id').notNull(),
  actorOnBehalfOf: text('actor_on_behalf_of'),
  provenance: jsonb('provenance').notNull(),
  causationId: text('causation_id').notNull(),
  correlationId: text('correlation_id').notNull(),
  principalId: text('principal_id').notNull(),
  domainId:text('domain_id').notNull(),
  privacyClass: text('privacy_class').notNull(),
  traceId: text('trace_id'),
  location: jsonb('location'),
  confidence: doublePrecision('confidence'),
  evidence: jsonb('evidence'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  payload: jsonb('payload').notNull(),
  meta: jsonb('meta'),
});

export const outbox = eventsSchema.table('outbox', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  eventId: text('event_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  lastError: text('last_error'),
});

export const idempotency = eventsSchema.table('idempotency', {
  consumer: text('consumer').notNull(),
  eventId: text('event_id').notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
});

export const deadLetter = eventsSchema.table('dead_letter', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  consumer: text('consumer').notNull(),
  eventId: text('event_id').notNull(),
  event: jsonb('event').notNull(),
  attempts: integer('attempts').notNull(),
  lastError: text('last_error').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// --- projections schema ---

export const stateSlices = projectionsSchema.table('state_slices', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  version: integer('version').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  lastEventId: text('last_event_id'),
  updatedByCorrelationId: text('updated_by_correlation_id'),
});

export const stateMeta = projectionsSchema.table('state_meta', {
  id: integer('id').primaryKey(),
  stateVersion: bigint('state_version', { mode: 'bigint' }).notNull().default(0n),
  checkpointEventId: text('checkpoint_event_id'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const snapshots = projectionsSchema.table('snapshots', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  stateVersion: bigint('state_version', { mode: 'bigint' }).notNull(),
  takenAt: timestamp('taken_at', { withTimezone: true }).notNull().defaultNow(),
  checkpointEventId: text('checkpoint_event_id'),
  slices: jsonb('slices').notNull(),
});

export const checkpoints = projectionsSchema.table('checkpoints', {
  projector: text('projector').primaryKey(),
  lastEventSeq: bigint('last_event_seq', { mode: 'bigint' }).notNull().default(0n),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// --- identity schema ---

export const principals = identitySchema.table('principals', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  isOperator: boolean('is_operator').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
});

export const identities = identitySchema.table('identities', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  principalId: text('principal_id').notNull(),
  externalRef: text('external_ref').notNull(),
  displayName: text('display_name').notNull(),
  trust: text('trust').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

export const credentials = identitySchema.table('credentials', {
  identityId: text('identity_id').notNull(),
  method: text('method').notNull(),
  secretHash: text('secret_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// --- session schema ---

export const sessions = sessionSchema.table('sessions', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  principalId: text('principal_id').notNull(),
  nodes: jsonb('nodes').notNull(),
  state: text('state').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
  openedByCorrelationId: text('opened_by_correlation_id').notNull(),
  parentSessionId: text('parent_session_id'),
  handoff: jsonb('handoff'),
  contextRef: text('context_ref'),
  version: integer('version').notNull().default(0),
});

// --- scheduler schema ---

export const jobRuns = schedulerSchema.table('job_runs', {
  id: text('id').primaryKey(),
  scheduleId: text('schedule_id').notNull(),
  status: text('status').notNull(),
  attempt: integer('attempt').notNull().default(0),
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  error: text('error'),
});

// Kernel-owned domain ledger; constraints and triggers live in 0018_domains.sql.
export const domains=identitySchema.table('domains',{id:text('id').primaryKey(),principalId:text('principal_id').notNull(),kind:text('kind').notNull(),name:text('name').notNull(),status:text('status').notNull().default('active'),version:integer('version').notNull().default(1),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow()});
export const domainSelections=identitySchema.table('domain_selections',{principalId:text('principal_id').notNull(),nodeId:text('node_id').notNull(),domainId:text('domain_id').notNull(),version:integer('version').notNull()});
export const domainBindings=identitySchema.table('domain_bindings',{principalId:text('principal_id').notNull(),correlationId:text('correlation_id').notNull(),domainId:text('domain_id').notNull(),purpose:text('purpose').notNull()});
export const domainFusionGrants=identitySchema.table('domain_fusion_grants',{id:text('id').primaryKey(),principalId:text('principal_id').notNull(),sourceDomainId:text('source_domain_id').notNull(),targetDomainId:text('target_domain_id').notNull(),purpose:text('purpose').notNull(),expiresAt:timestamp('expires_at',{withTimezone:true}).notNull(),revokedAt:timestamp('revoked_at',{withTimezone:true})});
export const secretReferences=pgSchema('agency').table('secret_references',{principalId:text('principal_id').notNull(),provider:text('provider').notNull(),domainId:text('domain_id').notNull(),secretRef:text('secret_ref').notNull()});
