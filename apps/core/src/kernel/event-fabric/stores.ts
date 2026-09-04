/**
 * PostgreSQL-backed implementations of the bus support stores + the outbox.
 */
import { type Sql } from '@jarvis/persistence';
import type { Event } from '@jarvis/contracts';
import type { DeadLetterSink, ProcessedLedger } from './bus.ts';

export class PgProcessedLedger implements ProcessedLedger {
  constructor(private readonly sql: Sql) {}
  async seen(consumer: string, eventId: string): Promise<boolean> {
    const rows = await this.sql<{ x: number }[]>`
      select 1 as x from events.idempotency
      where consumer = ${consumer} and event_id = ${eventId} limit 1`;
    return rows.length > 0;
  }
  async mark(consumer: string, eventId: string): Promise<void> {
    await this.sql`
      insert into events.idempotency (consumer, event_id) values (${consumer}, ${eventId})
      on conflict do nothing`;
  }
}

/** In-memory ledger for unit tests / no-DB runs. */
export class MemoryProcessedLedger implements ProcessedLedger {
  private readonly set = new Set<string>();
  async seen(consumer: string, eventId: string): Promise<boolean> {
    return this.set.has(`${consumer}::${eventId}`);
  }
  async mark(consumer: string, eventId: string): Promise<void> {
    this.set.add(`${consumer}::${eventId}`);
  }
}

export class PgDeadLetterSink implements DeadLetterSink {
  constructor(private readonly sql: Sql) {}
  async record(entry: { consumer: string; event: Event; attempts: number; lastError: string }): Promise<void> {
    await this.sql`
      insert into events.dead_letter (consumer, event_id, event, attempts, last_error)
      values (${entry.consumer}, ${entry.event.id}, ${JSON.stringify(entry.event)},
              ${entry.attempts}, ${entry.lastError})`;
  }
  async count(): Promise<number> {
    const [r] = await this.sql<{ c: string }[]>`select count(*)::text as c from events.dead_letter`;
    return Number(r?.c ?? '0');
  }
}

export class MemoryDeadLetterSink implements DeadLetterSink {
  readonly entries: Array<{ consumer: string; event: Event; attempts: number; lastError: string }> = [];
  async record(entry: { consumer: string; event: Event; attempts: number; lastError: string }): Promise<void> {
    this.entries.push(entry);
  }
  async count(): Promise<number> {
    return this.entries.length;
  }
}

export interface OutboxRow {
  id: string;
  eventId: string;
  attempts: number;
}

export class OutboxStore {
  constructor(private readonly sql: Sql) {}

  /** Enqueue within an existing transaction (called by the Event Manager). */
  async enqueueInTx(tx: Sql, eventIds: string[], nowIso?: string): Promise<void> {
    for (const id of eventIds) {
      await tx`insert into events.outbox (event_id, created_at, next_attempt_at) values (${id}, coalesce(${nowIso ?? null}::timestamptz, now()), coalesce(${nowIso ?? null}::timestamptz, now()))`;
    }
  }

  async claimBatch(limit: number, nowIso: string): Promise<OutboxRow[]> {
    const rows = await this.sql<{ id: string; event_id: string; attempts: number }[]>`
      update events.outbox set attempts = attempts + 1
      where id in (
        select id from events.outbox
        where dispatched_at is null and next_attempt_at <= ${nowIso}
        order by id asc limit ${limit}
        for update skip locked
      )
      returning id, event_id, attempts`;
    return rows.map((r) => ({ id: r.id, eventId: r.event_id, attempts: r.attempts }));
  }

  async markDispatched(id: string, nowIso: string): Promise<void> {
    await this.sql`update events.outbox set dispatched_at = ${nowIso} where id = ${id}`;
  }

  async reschedule(id: string, nextIso: string, error: string): Promise<void> {
    await this.sql`
      update events.outbox set next_attempt_at = ${nextIso}, last_error = ${error}
      where id = ${id}`;
  }

  async pendingCount(): Promise<number> {
    const [r] = await this.sql<{ c: string }[]>`
      select count(*)::text as c from events.outbox where dispatched_at is null`;
    return Number(r?.c ?? '0');
  }
}
