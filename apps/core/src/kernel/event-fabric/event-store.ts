/**
 * The append-only Event Store (PostgreSQL `events.events`, partitioned by
 * retentionClass). Source of truth for history. TRANSIENT events are never
 * written here - they exist only on the bus.
 *
 * Supports correlation lookup, causal-tree reconstruction, per-subject reads,
 * and sequential reads for replay / consumer catch-up (EVENT_ARCHITECTURE.md).
 */
import { type Sql } from '@jarvis/persistence';
import type { Event } from '@jarvis/contracts';

export interface StoredEvent extends Event {
  globalSeq: string; // bigint as string
}

interface Row {
  id: string;
  global_seq: string;
  type: string;
  schema_version: number;
  retention_class: string;
  time: string;
  recorded_at: string;
  source_node: string;
  source_component: string;
  subject_kind: string;
  subject_id: string;
  actor_kind: string;
  actor_id: string;
  actor_on_behalf_of: string | null;
  provenance: unknown;
  causation_id: string;
  correlation_id: string;
  principal_id: string;
  domain_id: string;
  privacy_class: string;
  trace_id: string | null;
  location: unknown;
  confidence: number | null;
  evidence: unknown;
  expires_at: string | null;
  payload: unknown;
  meta: unknown;
}

function rowToEvent(r: Row): StoredEvent {
  return {
    id: r.id,
    globalSeq: r.global_seq,
    type: r.type,
    schemaVersion: r.schema_version,
    retentionClass: r.retention_class as Event['retentionClass'],
    time: r.time,
    recordedAt: r.recorded_at,
    source: { node: r.source_node, component: r.source_component },
    subject: { kind: r.subject_kind, id: r.subject_id },
    actor: {
      kind: r.actor_kind as Event['actor']['kind'],
      id: r.actor_id,
      ...(r.actor_on_behalf_of ? { onBehalfOf: r.actor_on_behalf_of } : {}),
    },
    provenance: r.provenance as Event['provenance'],
    causationId: r.causation_id,
    correlationId: r.correlation_id,
    principalId: r.principal_id,
    domainId: r.domain_id,
    privacyClass: r.privacy_class as Event['privacyClass'],
    ...(r.trace_id ? { traceId: r.trace_id } : {}),
    ...(r.location ? { location: r.location as Event['location'] } : {}),
    ...(r.confidence != null ? { confidence: r.confidence } : {}),
    ...(r.evidence ? { evidence: r.evidence as string[] } : {}),
    ...(r.expires_at ? { expiresAt: r.expires_at } : {}),
    payload: r.payload,
    ...(r.meta ? { meta: r.meta as Record<string, string> } : {}),
  };
}

export class EventStore {
  constructor(private readonly sql: Sql) {}

  /**
   * Append fully-formed events within an existing transaction. Caller is
   * responsible for id/recordedAt already being set. Returns rows with
   * global_seq assigned. TRANSIENT drafts must be filtered out by the caller.
   */
  async appendInTx(tx: Sql, events: Event[]): Promise<StoredEvent[]> {
    if (events.length === 0) return [];
    const out: StoredEvent[] = [];
    for (const e of events) {
      const [row] = await tx<Row[]>`
        insert into events.events (
          id, type, schema_version, retention_class, time, recorded_at,
          source_node, source_component, subject_kind, subject_id,
          actor_kind, actor_id, actor_on_behalf_of, provenance,
          causation_id, correlation_id, principal_id, privacy_class,
          trace_id, location, confidence, evidence, expires_at, payload, meta, domain_id
        ) values (
          ${e.id}, ${e.type}, ${e.schemaVersion}, ${e.retentionClass},
          ${e.time}, ${e.recordedAt},
          ${e.source.node}, ${e.source.component}, ${e.subject.kind}, ${e.subject.id},
          ${e.actor.kind}, ${e.actor.id}, ${e.actor.onBehalfOf ?? null},
          ${JSON.stringify(e.provenance)},
          ${e.causationId}, ${e.correlationId}, ${e.principalId}, ${e.privacyClass},
          ${e.traceId ?? null},
          ${e.location ? JSON.stringify(e.location) : null},
          ${e.confidence ?? null},
          ${e.evidence ? JSON.stringify(e.evidence) : null},
          ${e.expiresAt ?? null},
          ${JSON.stringify(e.payload)},
          ${e.meta ? JSON.stringify(e.meta) : null}, ${e.domainId??null}
        )
        on conflict (retention_class, id) do nothing
        returning *
      `;
      if (row) out.push(rowToEvent(row));
    }
    return out;
  }

  async byId(id: string): Promise<StoredEvent | null> {
    const rows = await this.sql<Row[]>`select * from events.events where id = ${id} limit 1`;
    return rows[0] ? rowToEvent(rows[0]) : null;
  }

  async byCorrelation(correlationId: string): Promise<StoredEvent[]> {
    const rows = await this.sql<Row[]>`
      select * from events.events where correlation_id = ${correlationId}
      order by global_seq asc
    `;
    return rows.map(rowToEvent);
  }

  /** Full causal tree for an interaction: every event sharing the correlation id,
   *  plus ordering by causation so a caller can reconstruct the chain. */
  async causalTree(correlationId: string): Promise<StoredEvent[]> {
    return this.byCorrelation(correlationId);
  }

  async bySubject(kind: string, id: string, afterSeq = '0'): Promise<StoredEvent[]> {
    const rows = await this.sql<Row[]>`
      select * from events.events
      where subject_kind = ${kind} and subject_id = ${id} and global_seq > ${afterSeq}
      order by global_seq asc
    `;
    return rows.map(rowToEvent);
  }

  /** Sequential read for replay / catch-up, optionally restricted to one type. */
  async readFrom(afterGlobalSeq: string, limit = 1000, exactType?: string): Promise<StoredEvent[]> {
    const rows = exactType
      ? await this.sql<Row[]>`
          select * from events.events
          where global_seq > ${afterGlobalSeq} and type = ${exactType}
          order by global_seq asc limit ${limit}`
      : await this.sql<Row[]>`
          select * from events.events
          where global_seq > ${afterGlobalSeq}
          order by global_seq asc limit ${limit}`;
    return rows.map(rowToEvent);
  }

  /** Read the newest bounded window, returned in chronological order. */
  async readRecent(limit = 20): Promise<StoredEvent[]> {
    const rows = await this.sql<Row[]>`
      select * from events.events order by global_seq desc limit ${limit}`;
    return rows.reverse().map(rowToEvent);
  }

  async maxGlobalSeq(): Promise<string> {
    const [row] = await this.sql<{ seq: string | null }[]>`
      select max(global_seq)::text as seq from events.events`;
    return row?.seq ?? '0';
  }

  async count(): Promise<number> {
    const [row] = await this.sql<{ c: string }[]>`select count(*)::text as c from events.events`;
    return Number(row?.c ?? '0');
  }

  async countSince(iso: string): Promise<number> {
    const [row] = await this.sql<{ c: string }[]>`
      select count(*)::text as c from events.events where recorded_at >= ${iso}`;
    return Number(row?.c ?? '0');
  }
}
