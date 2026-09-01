/**
 * State projector. Pure fold of `state.mutated` events into the slice rows.
 *
 * Used for COLD-START REBUILD only (fed from the ReplayBus). During normal
 * operation the StateManager writes slices inline in the mutation transaction
 * (it IS the single writer). The projector is idempotent and monotonic:
 *  - an event whose newVersion <= the slice's current version is a
 *    duplicate / out-of-order / delayed delivery and is skipped
 *  - an event whose newVersion == current + 1 is applied
 *  - a gap (newVersion > current + 1) means an earlier event is missing;
 *    we still apply (the payload carries the full value) but record the gap
 */
import { EventNames, type Event, type StateSliceKey } from '@jarvis/contracts';
import { type Sql, jsonParam } from '@jarvis/persistence';
import { isReplay } from '../event-fabric/replay.ts';

export interface ProjectionStats {
  applied: number;
  skippedDuplicate: number;
  gaps: number;
}

interface StateMutatedPayload {
  key: StateSliceKey;
  value: unknown;
  newVersion: number;
  stateVersion: number;
}

export class StateProjector {
  readonly stats: ProjectionStats = { applied: 0, skippedDuplicate: 0, gaps: 0 };

  constructor(private readonly sql: Sql) {}

  /** Apply one event. Safe to call with any event; ignores non state.mutated. */
  async apply(event: Event): Promise<void> {
    if (event.type !== EventNames.StateMutated) return;
    const p = event.payload as StateMutatedPayload;

    const rows = await this.sql<{ version: number }[]>`
      select version from projections.state_slices where key = ${p.key} for update`;
    const current = rows[0]?.version;
    if (current === undefined) {
      // Unknown slice row - create it at this event's version.
      await this.sql`
        insert into projections.state_slices (key, value, version, last_event_id, updated_by_correlation_id)
        values (${p.key}, ${this.sql.json(jsonParam(p.value))}, ${p.newVersion}, ${event.id}, ${event.correlationId})
        on conflict (key) do nothing`;
      this.stats.applied++;
      return;
    }
    if (p.newVersion <= current) {
      this.stats.skippedDuplicate++;
      return;
    }
    if (p.newVersion > current + 1) this.stats.gaps++;

    await this.sql`
      update projections.state_slices
      set value = ${this.sql.json(jsonParam(p.value))},
          version = ${p.newVersion},
          updated_at = now(),
          last_event_id = ${event.id},
          updated_by_correlation_id = ${event.correlationId}
      where key = ${p.key}`;

    await this.sql`
      update projections.state_meta
      set state_version = greatest(state_version, ${p.stateVersion})
      where id = 1`;

    this.stats.applied++;
  }

  /** Effect-safety assertion: the projector must only ever see replay events
   *  when driven by rebuild. A live (non-replay) event reaching here during
   *  rebuild would indicate a wiring bug. */
  assertReplay(event: Event): void {
    if (!isReplay(event)) {
      throw new Error(`StateProjector received a non-replay event ${event.id}; replay != re-execution`);
    }
  }
}
