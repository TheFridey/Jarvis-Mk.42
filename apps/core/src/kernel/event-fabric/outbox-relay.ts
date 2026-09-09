/**
 * Outbox relay: polls events.outbox and publishes committed events to the bus
 * (ADR-0009). Runs only on the Kernel. If the bus is unhealthy it backs off and
 * retries - the events are safe in PostgreSQL. After `maxAttempts` an entry is
 * dead-lettered and, when eligible, one `event.dead_lettered` observation is emitted. A
 * failed observation is itself recorded in the DLQ but can never emit another.
 * the event-fabric subsystem reports DEGRADED.
 */
import { EventNames } from '@jarvis/contracts';
import type { Clock } from '../../runtime/clock.ts';
import type { EventBus } from './bus.ts';
import type { EventStore } from './event-store.ts';
import type { EventManager } from './event-manager.ts';
import type { DeadLetterSink } from './bus.ts';
import type { OutboxStore } from './stores.ts';

export interface OutboxRelayOptions {
  pollMs: number;
  batchSize: number;
  maxAttempts: number;
  baseBackoffMs: number;
}

export function deadLetterNotificationEligible(eventType: string): boolean {
  return eventType !== EventNames.EventDeadLettered;
}

export class OutboxRelay {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private activeRun?: Promise<void>;
  private stopped = true;
  private consecutiveFailures = 0;

  constructor(
    private readonly deps: {
      store: EventStore;
      outbox: OutboxStore;
      bus: EventBus;
      deadLetter: DeadLetterSink;
      events: EventManager;
      clock: Clock;
      onHealth: (status: 'HEALTHY' | 'DEGRADED', detail: string) => void | Promise<void>;
    },
    private readonly opts: OutboxRelayOptions,
  ) {}

  start(): void {
    this.stopped = false;
    this.schedule(0);
  }

  private schedule(delay: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), delay);
  }

  /** Run one drain pass immediately (used by tests and shutdown flush). */
  async tick(): Promise<void> {
    if (this.activeRun) return this.activeRun;
    const run=this.runTick();this.activeRun=run;
    try{await run}finally{if(this.activeRun===run)this.activeRun=undefined}
  }

  private async runTick():Promise<void>{
    try {
      const drained = await this.drainOnce();
      this.consecutiveFailures = 0;
      if (drained > 0) await this.deps.onHealth('HEALTHY', 'outbox draining');
    } catch (err) {
      this.consecutiveFailures++;
      const detail = err instanceof Error ? err.message : String(err);
      await this.deps.onHealth('DEGRADED', `outbox relay error: ${detail}`);
    } finally {
      const backoff = this.consecutiveFailures > 0
        ? Math.min(this.opts.pollMs * 2 ** this.consecutiveFailures, 30_000)
        : this.opts.pollMs;
      this.schedule(backoff);
    }
  }

  async drainOnce(): Promise<number> {
    let published = 0;
    // Keep draining while there is work and the bus is usable.
    for (;;) {
      const now = this.deps.clock.nowIso();
      const batch = await this.deps.outbox.claimBatch(this.opts.batchSize, now);
      if (batch.length === 0) break;

      for (const row of batch) {
        const event = await this.deps.store.byId(row.eventId);
        if (!event) {
          // Event vanished (should be impossible) - drop the outbox row.
          await this.deps.outbox.markDispatched(row.id, now);
          continue;
        }
        try {
          if (!this.deps.bus.isHealthy()) throw new Error('bus unhealthy');
          await this.deps.bus.publish(event);
          await this.deps.outbox.markDispatched(row.id, this.deps.clock.nowIso());
          published++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (row.attempts >= this.opts.maxAttempts) {
            await this.deps.deadLetter.record({
              consumer: 'outbox-relay',
              event,
              attempts: row.attempts,
              lastError: msg,
            });
            await this.deps.outbox.markDispatched(row.id, this.deps.clock.nowIso());
            if (deadLetterNotificationEligible(event.type)) await this.deps.events.emit({
                type: EventNames.EventDeadLettered,
                retentionClass: 'SECURITY',
                privacyClass: 'INTERNAL',
                subject: { kind: 'event', id: event.id },
                actor: { kind: 'system', id: 'outbox-relay' },
                correlationId: event.correlationId,
                causationId: event.id,
                principalId: event.principalId,
                payload: { eventId: event.id, consumer: 'outbox-relay', attempts: row.attempts, lastError: msg },
              }).catch(() => undefined);
            await this.deps.onHealth('DEGRADED', `outbox dead-lettered ${event.id}`);
          } else {
            const next = new Date(this.deps.clock.epochMs() + this.opts.baseBackoffMs * 2 ** row.attempts);
            await this.deps.outbox.reschedule(row.id, next.toISOString(), msg);
          }
          return published; // stop this pass; retry on the next tick
        }
      }
    }
    return published;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    // Join an in-flight pass before the final flush so no relay work can
    // outlive PostgreSQL during Kernel teardown.
    await this.activeRun;
    await this.tick().catch(() => undefined);
  }
}
