/**
 * CandidateSource — turns eligible events into MNEMOSYNE candidates
 * (MNEMOSYNE_MODEL.md §4). Do NOT persist every utterance: only events carrying
 * `retentionClass: MEMORY_CANDIDATE`, plus a small allow-list of outcome events
 * (cognition completed, objective transitioned, invocation verified), become
 * candidates. Everything else is left to be forgotten.
 *
 * Runs as a scan over the event store from a cursor (driven by the consolidation
 * routine), rather than a live bus subscription — deterministic and replay-safe.
 * Candidate creation is idempotent on `sourceEventId` via a guard query.
 */
import { EventNames } from '@jarvis/contracts';
import type { EventStore } from '../event-fabric/event-store.ts';
import type { Sql } from '@jarvis/persistence';
import type { KnowledgeIngestion } from './knowledge-ingestion.ts';

const ALLOW_TYPES = new Set<string>([
  EventNames.CognitionCompleted,
  EventNames.CognitionResultDelivered,
  EventNames.ObjectiveTransitioned,
  EventNames.InvocationVerified,
]);

export class CandidateSource {
  constructor(
    private readonly deps: { eventStore: EventStore; ingestion: KnowledgeIngestion; sql: Sql },
  ) {}

  /** Scan forward from `afterGlobalSeq`; return how many candidates were created
   *  and the new cursor. */
  async harvest(afterGlobalSeq: string, batch = 500): Promise<{ created: number; cursor: string }> {
    let cursor = afterGlobalSeq;
    let created = 0;
    for (;;) {
      const page = await this.deps.eventStore.readFrom(cursor, batch);
      if (page.length === 0) break;
      for (const e of page) {
        cursor = e.globalSeq;
        if (!ALLOW_TYPES.has(e.type) && e.retentionClass !== 'MEMORY_CANDIDATE') continue;
        const [dup] = await this.deps.sql<{ id: string }[]>`
          select id from mnemosyne.candidates where source_event_id = ${e.id} limit 1`;
        if (dup) continue;
        const id = await this.deps.ingestion.recordEventCandidate(e);
        if (id) created++;
      }
      if (page.length < batch) break;
    }
    return { created, cursor };
  }
}
