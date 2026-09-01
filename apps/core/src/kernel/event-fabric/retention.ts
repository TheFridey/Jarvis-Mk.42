/**
 * Retention sweeper. Deletes persisted events past their class TTL
 * (ADR-0009 Amendment 1). MK.43 uses bounded DELETEs; partition-drop is a later
 * optimization. TRANSIENT is never here (never persisted).
 */
import type { Sql } from '@jarvis/persistence';
import type { Clock } from '../../runtime/clock.ts';
import type { RetentionClass } from '@jarvis/contracts';

const TTL_DAYS: Partial<Record<RetentionClass, number>> = {
  OPERATIONAL: 90,
  MEMORY_CANDIDATE: 30,
  DIAGNOSTIC: 14,
  // AUDIT and SECURITY: retained indefinitely (no sweep).
};

export interface SweepResult {
  deletedByClass: Partial<Record<RetentionClass, number>>;
  total: number;
}

export class RetentionSweeper {
  constructor(
    private readonly sql: Sql,
    private readonly clock: Clock,
    private readonly batchSize = 5000,
  ) {}

  async sweep(): Promise<SweepResult> {
    const deletedByClass: Partial<Record<RetentionClass, number>> = {};
    let total = 0;
    for (const [cls, days] of Object.entries(TTL_DAYS) as [RetentionClass, number][]) {
      const cutoff = new Date(this.clock.epochMs() - days * 86_400_000).toISOString();
      // Delete in bounded batches to avoid long locks.
      for (;;) {
        const rows = await this.sql<{ c: string }[]>`
          with victims as (
            select id, retention_class from events.events
            where retention_class = ${cls} and recorded_at < ${cutoff}
            limit ${this.batchSize}
          )
          delete from events.events e
          using victims v
          where e.id = v.id and e.retention_class = v.retention_class
          returning 1 as c`;
        const n = rows.length;
        deletedByClass[cls] = (deletedByClass[cls] ?? 0) + n;
        total += n;
        if (n < this.batchSize) break;
      }
    }
    return { deletedByClass, total };
  }
}
