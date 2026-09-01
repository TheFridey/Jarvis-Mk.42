/**
 * The Validator entry points. Every untrusted -> Kernel path calls one of
 * these (SECURITY_MODEL.md sec 4). Returns a discriminated result; never throws
 * on invalid input.
 */
import { z } from 'zod';
import type { Event, EventDraft } from '@jarvis/contracts';
import { eventDraftSchema, eventSchema } from './event.schema.ts';
import { hasPayloadSchema, payloadSchemaFor } from './payloads.schema.ts';

export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
}

export type ValidationOutcome<T> =
  | { ok: true; value: T; unknownType: boolean }
  | { ok: false; issues: ValidationIssue[] };

function toIssues(err: z.ZodError): ValidationIssue[] {
  return err.issues.map((i) => ({
    path: i.path.join('.') || '(root)',
    code: i.code,
    message: i.message,
  }));
}

/** Validate a draft event (structure + payload for known types). */
export function validateEventDraft(input: unknown): ValidationOutcome<EventDraft> {
  const structural = eventDraftSchema.safeParse(input);
  if (!structural.success) return { ok: false, issues: toIssues(structural.error) };

  const { type, schemaVersion, payload } = structural.data;
  const known = hasPayloadSchema(type, schemaVersion);
  if (known) {
    const payloadResult = payloadSchemaFor(type, schemaVersion).safeParse(payload);
    if (!payloadResult.success) {
      return {
        ok: false,
        issues: toIssues(payloadResult.error).map((i) => ({
          ...i,
          path: `payload.${i.path}`,
        })),
      };
    }
  }
  return { ok: true, value: structural.data as EventDraft, unknownType: !known };
}

/** Validate a fully-formed persisted event (used on ingest from the bus). */
export function validateEvent(input: unknown): ValidationOutcome<Event> {
  const structural = eventSchema.safeParse(input);
  if (!structural.success) return { ok: false, issues: toIssues(structural.error) };
  const { type, schemaVersion, payload } = structural.data;
  const known = hasPayloadSchema(type, schemaVersion);
  if (known) {
    const payloadResult = payloadSchemaFor(type, schemaVersion).safeParse(payload);
    if (!payloadResult.success) {
      return {
        ok: false,
        issues: toIssues(payloadResult.error).map((i) => ({
          ...i,
          path: `payload.${i.path}`,
        })),
      };
    }
  }
  return { ok: true, value: structural.data as Event, unknownType: !known };
}

/** Generic helper for validating any request DTO against a provided schema. */
export function validateWith<T>(
  schema: z.ZodType<T>,
  input: unknown,
): ValidationOutcome<T> {
  const r = schema.safeParse(input);
  return r.success
    ? { ok: true, value: r.data, unknownType: false }
    : { ok: false, issues: toIssues(r.error) };
}
