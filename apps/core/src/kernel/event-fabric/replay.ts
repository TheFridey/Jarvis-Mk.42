/**
 * Replay engine (EVENT_ARCHITECTURE.md sec 7). Replay != re-execution.
 *
 * The ReplayBus is a SEPARATE channel from the live EventBus. Only pure
 * projector consumers may subscribe to it. Every replayed event carries
 * `meta.replay = "true"`. Effect-causing consumers subscribe to the live bus
 * and additionally refuse any event with that tag.
 */
import type { Event } from '@jarvis/contracts';
import type { EventStore, StoredEvent } from './event-store.ts';

export type ProjectorFn = (event: Event) => Promise<void>;

export class ReplayBus {
  private readonly projectors: { name: string; fn: ProjectorFn }[] = [];

  registerProjector(name: string, fn: ProjectorFn): void {
    this.projectors.push({ name, fn });
  }

  async feed(event: Event): Promise<void> {
    const tagged: Event = { ...event, meta: { ...(event.meta ?? {}), replay: 'true' } };
    for (const p of this.projectors) {
      await p.fn(tagged);
    }
  }
}

export interface ReplayResult {
  replayed: number;
  lastGlobalSeq: string;
}

export class ReplayEngine {
  constructor(
    private readonly store: EventStore,
    private readonly replayBus: ReplayBus,
  ) {}

  /** Replay every persisted event after `fromGlobalSeq` into the projectors. */
  async replayAll(fromGlobalSeq = '0', pageSize = 1000): Promise<ReplayResult> {
    let cursor = fromGlobalSeq;
    let replayed = 0;
    for (;;) {
      const page: StoredEvent[] = await this.store.readFrom(cursor, pageSize);
      if (page.length === 0) break;
      for (const e of page) {
        await this.replayBus.feed(e);
        cursor = e.globalSeq;
        replayed++;
      }
      if (page.length < pageSize) break;
    }
    return { replayed, lastGlobalSeq: cursor };
  }

  /** Replay a single interaction into an isolated sink (time-travel debugging). */
  async replayCorrelation(correlationId: string, sink: (e: Event) => Promise<void>): Promise<number> {
    const events = await this.store.byCorrelation(correlationId);
    for (const e of events) {
      await sink({ ...e, meta: { ...(e.meta ?? {}), replay: 'true' } });
    }
    return events.length;
  }
}

/** Guard for effect-causing consumers: true when the event is a replay. */
export function isReplay(event: Event): boolean {
  return event.meta?.replay === 'true';
}
