import { describe, expect, it, vi } from 'vitest';
import { makeEvent } from '@jarvis/testkit';
import { deliverWithGuards, subjectMatches } from './bus.ts';
import { InProcessEventBus } from './in-process-bus.ts';
import { MemoryDeadLetterSink, MemoryProcessedLedger } from './stores.ts';

describe('subjectMatches', () => {
  it('matches exact and wildcard patterns', () => {
    expect(subjectMatches('jarvis.kernel.mode.changed', 'jarvis.kernel.mode.changed')).toBe(true);
    expect(subjectMatches('jarvis.kernel.>', 'jarvis.kernel.mode.changed')).toBe(true);
    expect(subjectMatches('jarvis.*.mode.changed', 'jarvis.kernel.mode.changed')).toBe(true);
    expect(subjectMatches('jarvis.perception.>', 'jarvis.kernel.mode.changed')).toBe(false);
    expect(subjectMatches('jarvis.kernel.mode', 'jarvis.kernel.mode.changed')).toBe(false);
  });
});

describe('deliverWithGuards', () => {
  it('is idempotent - a second delivery of the same event id is a no-op', async () => {
    const processed = new MemoryProcessedLedger();
    const dl = new MemoryDeadLetterSink();
    const handler = vi.fn(async () => undefined);
    const e = makeEvent();
    const opts = { consumer: 'c1', handler, maxAttempts: 3, backoffMs: 1 };
    await deliverWithGuards(e, opts, { processed, deadLetter: dl });
    await deliverWithGuards(e, opts, { processed, deadLetter: dl });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('retries then dead-letters after the attempt budget', async () => {
    const processed = new MemoryProcessedLedger();
    const dl = new MemoryDeadLetterSink();
    const handler = vi.fn(async () => {
      throw new Error('boom');
    });
    const onDeadLetter = vi.fn();
    await deliverWithGuards(
      makeEvent(),
      { consumer: 'c2', handler, maxAttempts: 3, backoffMs: 1 },
      { processed, deadLetter: dl, onDeadLetter },
    );
    expect(handler).toHaveBeenCalledTimes(3);
    expect(dl.entries).toHaveLength(1);
    expect(dl.entries[0]!.attempts).toBe(3);
    expect(onDeadLetter).toHaveBeenCalledOnce();
  });

  it('recovers if a later attempt succeeds', async () => {
    const processed = new MemoryProcessedLedger();
    const dl = new MemoryDeadLetterSink();
    let n = 0;
    const handler = vi.fn(async () => {
      if (++n < 2) throw new Error('transient');
    });
    await deliverWithGuards(
      makeEvent(),
      { consumer: 'c3', handler, maxAttempts: 5, backoffMs: 1 },
      { processed, deadLetter: dl },
    );
    expect(handler).toHaveBeenCalledTimes(2);
    expect(dl.entries).toHaveLength(0);
  });
});

describe('InProcessEventBus', () => {
  it('delivers published events to matching subscribers in publish order', async () => {
    const bus = new InProcessEventBus(new MemoryProcessedLedger(), new MemoryDeadLetterSink());
    await bus.start();
    const seen: string[] = [];
    await bus.subscribe({
      consumer: 'orderer',
      subjects: ['jarvis.kernel.>'],
      handler: async (e) => {
        seen.push((e.payload as { n: number }).n.toString());
      },
    });
    for (let i = 0; i < 5; i++) {
      await bus.publish(makeEvent({ type: 'jarvis.kernel.test.n', payload: { n: i } }));
    }
    await bus.idle();
    expect(seen).toEqual(['0', '1', '2', '3', '4']);
  });

  it('does not deliver to non-matching subjects', async () => {
    const bus = new InProcessEventBus(new MemoryProcessedLedger(), new MemoryDeadLetterSink());
    await bus.start();
    const handler = vi.fn(async () => undefined);
    await bus.subscribe({ consumer: 'perc', subjects: ['jarvis.perception.>'], handler });
    await bus.publish(makeEvent({ type: 'jarvis.kernel.mode.changed' }));
    await bus.idle();
    expect(handler).not.toHaveBeenCalled();
  });

  it('suppresses a re-published duplicate event id', async () => {
    const bus = new InProcessEventBus(new MemoryProcessedLedger(), new MemoryDeadLetterSink());
    await bus.start();
    const handler = vi.fn(async () => undefined);
    await bus.subscribe({ consumer: 'dedupe', subjects: ['jarvis.>'], handler });
    const e = makeEvent();
    await bus.publish(e);
    await bus.publish(e);
    await bus.idle();
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
