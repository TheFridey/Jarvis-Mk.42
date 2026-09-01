/**
 * In-process EventBus. Used in development without NATS and in unit tests.
 * Delivers synchronously-ish (via microtask) to matching subscribers, with the
 * same idempotency/retry/dead-letter guarantees as the NATS bus.
 *
 * Per-subject ordering: publishes are processed one at a time through an
 * internal queue, preserving the order in which the Event Manager appended.
 */
import type { Event } from '@jarvis/contracts';
import {
  deliverWithGuards,
  subjectMatches,
  type ConsumerOptions,
  type DeadLetterSink,
  type EventBus,
  type ProcessedLedger,
  type Subscription,
} from './bus.ts';

interface Registered {
  opts: Required<ConsumerOptions>;
}

export class InProcessEventBus implements EventBus {
  private readonly subs = new Map<string, Registered>();
  private queue: Event[] = [];
  private draining = false;
  private healthy = true;

  constructor(
    private readonly processed: ProcessedLedger,
    private readonly deadLetter: DeadLetterSink,
    private readonly onDeadLetter?: (e: Event, err: string) => void,
  ) {}

  async start(): Promise<void> {
    this.healthy = true;
  }

  isHealthy(): boolean {
    return this.healthy;
  }

  /** Test/failure-injection hook. */
  setHealthy(v: boolean): void {
    this.healthy = v;
  }

  async publish(event: Event): Promise<void> {
    if (!this.healthy) throw new Error('in-process bus marked unhealthy');
    this.queue.push(event);
    if (!this.draining) void this.drain();
  }

  private async drain(): Promise<void> {
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const event = this.queue.shift()!;
        const targets = [...this.subs.values()].filter((r) =>
          r.opts.subjects.some((p) => subjectMatches(p, event.type)),
        );
        for (const r of targets) {
          await deliverWithGuards(event, r.opts, {
            processed: this.processed,
            deadLetter: this.deadLetter,
            onDeadLetter: this.onDeadLetter,
          });
        }
      }
    } finally {
      this.draining = false;
    }
  }

  async subscribe(opts: ConsumerOptions): Promise<Subscription> {
    const full: Required<ConsumerOptions> = {
      maxAttempts: 5,
      backoffMs: 100,
      ...opts,
    };
    this.subs.set(full.consumer, { opts: full });
    return {
      consumer: full.consumer,
      close: async () => {
        this.subs.delete(full.consumer);
      },
    };
  }

  /** Block until the delivery queue is empty (tests). */
  async idle(): Promise<void> {
    while (this.draining || this.queue.length > 0) {
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  async close(): Promise<void> {
    this.subs.clear();
    this.queue = [];
  }
}
