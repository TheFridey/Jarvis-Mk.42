/**
 * PostgreSQL access for Projected State: the slice rows, the singleton
 * state_meta (global version + replay checkpoint), and snapshots.
 *
 * The StateManager is the ONLY writer path for slices (single-writer,
 * STATE_MODEL.md sec 3). All writes happen inside the same transaction as the
 * `state.mutated` event (transactional outbox).
 */
import { type Sql, jsonParam } from '@jarvis/persistence';
import type {
  StateSlice,
  StateSliceKey,
  StateSnapshot,
  SystemStateView,
} from '@jarvis/contracts';
import { ALL_SLICE_KEYS, INITIAL_SLICE_VALUES } from './defaults.ts';

interface SliceRow {
  key: string;
  value: unknown;
  version: number;
  updated_at: string;
  last_event_id: string | null;
  updated_by_correlation_id: string | null;
}

function rowToSlice(r: SliceRow): StateSlice {
  return {
    key: r.key as StateSliceKey,
    value: r.value,
    version: r.version,
    updatedAt: r.updated_at,
    lastEventId: r.last_event_id,
    updatedByCorrelationId: r.updated_by_correlation_id,
  };
}

export class StateStore {
  constructor(private readonly sql: Sql) {}

  /** Create any missing slice rows with their initial values (idempotent). */
  async ensureInitialised(): Promise<void> {
    for (const key of ALL_SLICE_KEYS) {
      await this.sql`
        insert into projections.state_slices (key, value, version)
        values (${key}, ${this.sql.json(jsonParam(INITIAL_SLICE_VALUES[key]))}, 0)
        on conflict (key) do nothing`;
    }
    await this.sql`
      insert into projections.state_meta (id) values (1) on conflict do nothing`;
  }

  async getSlice(key: StateSliceKey): Promise<StateSlice | null> {
    const rows = await this.sql<SliceRow[]>`
      select * from projections.state_slices where key = ${key} limit 1`;
    return rows[0] ? rowToSlice(rows[0]) : null;
  }

  async allSlices(): Promise<Record<StateSliceKey, StateSlice>> {
    const rows = await this.sql<SliceRow[]>`select * from projections.state_slices`;
    const out = {} as Record<StateSliceKey, StateSlice>;
    for (const r of rows) out[r.key as StateSliceKey] = rowToSlice(r);
    return out;
  }

  async stateVersion(): Promise<bigint> {
    const [row] = await this.sql<{ state_version: string }[]>`
      select state_version::text from projections.state_meta where id = 1`;
    return BigInt(row?.state_version ?? '0');
  }

  async view(): Promise<SystemStateView> {
    const [slices, sv] = await Promise.all([this.allSlices(), this.stateVersion()]);
    return {
      stateVersion: Number(sv),
      generatedAt: new Date().toISOString(),
      slices,
    };
  }

  /** Bump the monotonic global state version inside `tx`; returns the new value. */
  async bumpStateVersionInTx(tx: Sql): Promise<bigint> {
    const [meta] = await tx<{ state_version: string }[]>`
      update projections.state_meta
      set state_version = state_version + 1, updated_at = now()
      where id = 1
      returning state_version::text`;
    return BigInt(meta?.state_version ?? '0');
  }

  /** Write the new slice value + provenance inside `tx`. */
  async writeSliceInTx(
    tx: Sql,
    args: {
      key: StateSliceKey;
      value: unknown;
      newVersion: number;
      eventId: string;
      correlationId: string;
    },
  ): Promise<void> {
    await tx`
      update projections.state_slices
      set value = ${tx.json(jsonParam(args.value))},
          version = ${args.newVersion},
          updated_at = now(),
          last_event_id = ${args.eventId},
          updated_by_correlation_id = ${args.correlationId}
      where key = ${args.key}`;
  }

  /** Lock + read a slice's current version inside a tx (optimistic-concurrency gate). */
  async lockSliceVersion(tx: Sql, key: StateSliceKey): Promise<number | null> {
    const rows = await tx<{ version: number }[]>`
      select version from projections.state_slices where key = ${key} for update`;
    return rows[0]?.version ?? null;
  }

  // --- snapshots ---

  async takeSnapshot(checkpointEventId: string | null): Promise<StateSnapshot> {
    const view = await this.view();
    await this.sql`
      insert into projections.snapshots (state_version, checkpoint_event_id, slices)
      values (${view.stateVersion}, ${checkpointEventId}, ${this.sql.json(jsonParam(view.slices))})`;
    await this.sql`
      update projections.state_meta set checkpoint_event_id = ${checkpointEventId} where id = 1`;
    return {
      stateVersion: view.stateVersion,
      takenAt: new Date().toISOString(),
      checkpointEventId,
      slices: view.slices,
    };
  }

  async latestSnapshot(): Promise<StateSnapshot | null> {
    const rows = await this.sql<
      { state_version: string; taken_at: string; checkpoint_event_id: string | null; slices: unknown }[]
    >`select state_version::text, taken_at, checkpoint_event_id, slices
      from projections.snapshots order by id desc limit 1`;
    const r = rows[0];
    if (!r) return null;
    return {
      stateVersion: Number(r.state_version),
      takenAt: r.taken_at,
      checkpointEventId: r.checkpoint_event_id,
      slices: r.slices as Record<StateSliceKey, StateSlice>,
    };
  }

  async checkpointEventId(): Promise<string | null> {
    const [row] = await this.sql<{ checkpoint_event_id: string | null }[]>`
      select checkpoint_event_id from projections.state_meta where id = 1`;
    return row?.checkpoint_event_id ?? null;
  }
}
