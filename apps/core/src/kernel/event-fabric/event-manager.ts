/**
 * Event Manager (KERNEL_CONSTITUTION.md sec 1 #3).
 *
 * The single way anything in the Kernel emits an event. Responsibilities:
 *  - fill envelope defaults (id, recordedAt, traceId, provenance)
 *  - validate against the schema + per-type payload schema (reject on mismatch)
 *  - for non-TRANSIENT: append to the store + enqueue the outbox in ONE tx
 *    (transactional outbox, ADR-0009)
 *  - for TRANSIENT: publish straight to the bus, never persisted
 *
 * State changes that must be atomic with their event call `emitInTx(tx, ...)`
 * so the caller controls the transaction.
 */
import { validateEventDraft } from '@jarvis/validation';
import { EventNames, type Event, type EventActor, type PrivacyClass, type Provenance, type RetentionClass } from '@jarvis/contracts';
import type { Sql } from '@jarvis/persistence';
import { currentTraceId } from '@jarvis/telemetry';
import type { Clock } from '../../runtime/clock.ts';
import type { IdGen } from '../../runtime/ids.ts';
import type { EventBus } from './bus.ts';
import type { EventStore } from './event-store.ts';
import type { OutboxStore } from './stores.ts';

export interface EmitInput {
  type: string;
  schemaVersion?: number;
  retentionClass: RetentionClass;
  privacyClass: PrivacyClass;
  subject: { kind: string; id: string };
  actor: EventActor;
  correlationId: string;
  causationId: string;
  principalId: string;
  payload: unknown;
  time?: string;
  traceId?: string;
  provenance?: Partial<Provenance>;
  location?: Event['location'];
  confidence?: number;
  evidence?: string[];
  expiresAt?: string;
  meta?: Record<string, string>;
  sourceComponent?: string;
}

export class EventRejectedError extends Error {
  constructor(
    readonly attemptedType: string,
    readonly issues: { path: string; code: string; message: string }[],
  ) {
    super(`event rejected (${attemptedType}): ${issues.map((i) => `${i.path} ${i.message}`).join('; ')}`);
    this.name = 'EventRejectedError';
  }
}

export interface TxRunner {
  begin<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
}

export class EventManager {
  private appended = 0;

  constructor(
    private readonly deps: {
      sql: Sql;
      tx: TxRunner;
      store: EventStore;
      outbox: OutboxStore;
      bus: EventBus;
      clock: Clock;
      ids: IdGen;
      component: string;
      nodeId: string;
    },
  ) {}

  get appendedCount(): number {
    return this.appended;
  }

  private buildEvent(input: EmitInput): Event {
    const now = this.deps.clock.nowIso();
    const time = input.time ?? now;
    const provenance: Provenance = {
      method: input.provenance?.method ?? 'system',
      producedBy: input.provenance?.producedBy ?? this.deps.component,
      producedOn: input.provenance?.producedOn ?? this.deps.nodeId,
      producedAt: input.provenance?.producedAt ?? time,
      correlationId: input.provenance?.correlationId ?? input.correlationId,
      derivedFromUntrusted: input.provenance?.derivedFromUntrusted ?? false,
      ...(input.provenance?.model ? { model: input.provenance.model } : {}),
      ...(input.provenance?.sourceRefs ? { sourceRefs: input.provenance.sourceRefs } : {}),
    };
    const event: Event = {
      id: this.deps.ids.ulid(),
      type: input.type,
      schemaVersion: input.schemaVersion ?? 1,
      retentionClass: input.retentionClass,
      time,
      recordedAt: now,
      source: { node: this.deps.nodeId, component: input.sourceComponent ?? this.deps.component },
      subject: input.subject,
      actor: input.actor,
      provenance,
      causationId: input.causationId,
      correlationId: input.correlationId,
      principalId: input.principalId,
      privacyClass: input.privacyClass,
      payload: input.payload,
      ...(input.traceId ?? currentTraceId() ? { traceId: input.traceId ?? currentTraceId() } : {}),
      ...(input.location ? { location: input.location } : {}),
      ...(input.confidence != null ? { confidence: input.confidence } : {}),
      ...(input.evidence ? { evidence: input.evidence } : {}),
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
      ...(input.meta ? { meta: input.meta } : {}),
    };
    return event;
  }

  private validateOrThrow(event: Event): void {
    if (event.type.startsWith('jarvis.agency.invocation.') && event.source.component !== 'capability-executor') {
      throw new EventRejectedError(event.type, [{ path: 'source.component', code: 'forbidden_source', message: 'agency lifecycle events may only be emitted by capability-executor' }]);
    }
    const result = validateEventDraft(event);
    if (!result.ok) {
      throw new EventRejectedError(event.type, result.issues);
    }
  }

  private async emitRejected(
    attemptedType: string,
    issues: { path: string; code: string; message: string }[],
  ): Promise<void> {
    if (attemptedType === EventNames.EventRejected) return;
    await this.emit({
      type: EventNames.EventRejected,
      retentionClass: 'DIAGNOSTIC',
      privacyClass: 'INTERNAL',
      subject: { kind: 'event', id: attemptedType },
      actor: { kind: 'system', id: this.deps.component },
      correlationId: this.deps.ids.ulid(),
      causationId: 'none',
      principalId: 'system',
      payload: { attemptedType, reason: issues.map((i) => `${i.path}: ${i.message}`).join('; ') },
    });
  }

  /** Emit standalone (opens its own transaction for persistence + outbox). */
  async emit(input: EmitInput): Promise<Event> {
    const event = this.buildEvent(input);
    try { this.validateOrThrow(event); } catch (error) { if (error instanceof EventRejectedError) await this.emitRejected(event.type, error.issues).catch(() => undefined); throw error; }

    if (event.retentionClass === 'TRANSIENT') {
      await this.deps.bus.publish(event).catch(() => undefined);
      return event;
    }

    await this.deps.tx.begin(async (tx) => {
      await this.deps.store.appendInTx(tx, [event]);
      await this.deps.outbox.enqueueInTx(tx, [event.id], event.recordedAt);
    });
    this.appended++;
    return event;
  }

  /**
   * Emit inside a caller-owned transaction so a state change and its event
   * commit atomically. The outbox row is enqueued in the same tx; the relay
   * publishes after commit.
   */
  async emitInTx(tx: Sql, input: EmitInput): Promise<Event> {
    const event = this.buildEvent(input);
    this.validateOrThrow(event);
    if (event.retentionClass === 'TRANSIENT') {
      // TRANSIENT never participates in a persistence tx.
      queueMicrotask(() => void this.deps.bus.publish(event).catch(() => undefined));
      return event;
    }
    await this.deps.store.appendInTx(tx, [event]);
    await this.deps.outbox.enqueueInTx(tx, [event.id], event.recordedAt);
    this.appended++;
    return event;
  }
}
