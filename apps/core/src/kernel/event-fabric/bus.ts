/**
 * EventBus - the transport abstraction over which persisted events fan out to
 * consumers. Two implementations: InProcessEventBus (dev/tests) and NatsEventBus
 * (JetStream). Consumers get at-least-once delivery, per-subject ordering,
 * bounded retry, idempotency, and a dead-letter path - all provided here so no
 * consumer reimplements it (ADR-0005).
 */
import type { Event } from '@jarvis/contracts';

export interface ConsumerOptions {
  /** Stable consumer id - used for the durable subscription and idempotency. */
  consumer: string;
  /**
   * Subject patterns to receive. `jarvis.>` for everything.
   * Matching is prefix/segment based: `jarvis.kernel.>` , exact, or `*`.
   */
  subjects: string[];
  handler: (event: Event) => Promise<void>;
  /** Max delivery attempts before dead-lettering. Default 5. */
  maxAttempts?: number;
  /** Base backoff between attempts (ms). Default 100. */
  backoffMs?: number;
}

export interface Subscription {
  consumer: string;
  close(): Promise<void>;
}

export interface EventBus {
  start(): Promise<void>;
  publish(event: Event): Promise<void>;
  subscribe(opts: ConsumerOptions): Promise<Subscription>;
  /** True when the transport is currently connected/usable. */
  isHealthy(): boolean;
  close(): Promise<void>;
}

/** Records that a consumer has processed an event (idempotency, EVENT_ARCHITECTURE.md sec 5). */
export interface ProcessedLedger {
  seen(consumer: string, eventId: string): Promise<boolean>;
  mark(consumer: string, eventId: string): Promise<void>;
}

export interface DeadLetterSink {
  record(entry: {
    consumer: string;
    event: Event;
    attempts: number;
    lastError: string;
  }): Promise<void>;
}

/** Segment-aware subject matcher: supports trailing `>` and single-segment `*`. */
export function subjectMatches(pattern: string, subject: string): boolean {
  if (pattern === subject) return true;
  const p = pattern.split('.');
  const s = subject.split('.');
  for (let i = 0; i < p.length; i++) {
    const seg = p[i];
    if (seg === '>') return true;
    if (i >= s.length) return false;
    if (seg === '*') continue;
    if (seg !== s[i]) return false;
  }
  return p.length === s.length;
}

/**
 * Wraps a consumer handler with idempotency + bounded retry + dead-lettering.
 * Shared by both bus implementations.
 */
export async function deliverWithGuards(
  event: Event,
  opts: Required<Pick<ConsumerOptions, 'consumer' | 'handler' | 'maxAttempts' | 'backoffMs'>>,
  deps: { processed: ProcessedLedger; deadLetter: DeadLetterSink; onDeadLetter?: (e: Event, err: string) => void },
): Promise<void> {
  if (await deps.processed.seen(opts.consumer, event.id)) return;

  let lastError = '';
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      await opts.handler(event);
      await deps.processed.mark(opts.consumer, event.id);
      return;
    } catch (err) {
      lastError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      if (attempt < opts.maxAttempts) {
        await sleep(opts.backoffMs * attempt);
      }
    }
  }
  await deps.deadLetter.record({
    consumer: opts.consumer,
    event,
    attempts: opts.maxAttempts,
    lastError,
  });
  deps.onDeadLetter?.(event, lastError);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
