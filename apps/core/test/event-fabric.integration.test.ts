import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventNames } from '@jarvis/contracts';
import { isDockerAvailable } from '@jarvis/testkit';
import { setupIt, truncateAll, type ItContext } from './it-harness.ts';

const dockerOk = await isDockerAvailable();

describe.skipIf(!dockerOk)('event fabric (integration)', () => {
  let ctx: ItContext;

  beforeAll(async () => {
    ctx = await setupIt();
  }, 240_000);

  afterAll(async () => {
    await ctx?.cleanup();
  });

  it('persists a non-TRANSIENT event, enqueues the outbox, and the relay publishes it to the bus', async () => {
    await truncateAll(ctx.pg);
    const k = ctx.makeKernel();

    const received: string[] = [];
    await k.bus.start();
    await k.bus.subscribe({
      consumer: 'test-observer',
      subjects: ['jarvis.>'],
      handler: async (e) => {
        received.push(e.type);
      },
    });

    const event = await k.events.emit({
      type: 'jarvis.kernel.test.happened',
      retentionClass: 'OPERATIONAL',
      privacyClass: 'INTERNAL',
      subject: { kind: 'test', id: 't1' },
      actor: { kind: 'system', id: 'test' },
      correlationId: k.ids.ulid(),
      causationId: 'none',
      principalId: 'system',
      payload: { hello: 'world' },
    });

    // persisted
    const stored = await k.eventStore.byId(event.id);
    expect(stored?.type).toBe('jarvis.kernel.test.happened');
    expect(await k.eventStore.count()).toBe(1);

    // outbox drains via the relay
    await k.outboxRelay.tick();
    await new Promise((r) => setTimeout(r, 50));
    await k.outboxRelay.tick();
    expect(received).toContain('jarvis.kernel.test.happened');
    expect(await k.outboxRelay.drainOnce()).toBe(0); // nothing left to publish
  });

  it('rejects an event whose payload violates the per-type schema (schema mismatch)', async () => {
    await truncateAll(ctx.pg);
    const k = ctx.makeKernel();
    await expect(
      k.events.emit({
        type: EventNames.ModeChanged,
        retentionClass: 'OPERATIONAL',
        privacyClass: 'INTERNAL',
        subject: { kind: 'mode', id: 'system' },
        actor: { kind: 'system', id: 'mode-manager' },
        correlationId: k.ids.ulid(),
        causationId: 'none',
        principalId: 'system',
        payload: { from: 'DORMANT' /* missing to/trigger/reason/version */ },
      }),
    ).rejects.toThrow(/rejected/i);
    // nothing persisted for the bad event; only the self-observation rejected event
    const all = await k.eventStore.readFrom('0', 100);
    expect(all.every((e) => e.type !== EventNames.ModeChanged)).toBe(true);
    expect(all.some((e) => e.type === EventNames.EventRejected)).toBe(true);
  });

  it('is idempotent on event id: a re-append with the same id does not duplicate', async () => {
    await truncateAll(ctx.pg);
    const k = ctx.makeKernel();
    const e = await k.events.emit({
      type: 'jarvis.kernel.test.dupe',
      retentionClass: 'OPERATIONAL',
      privacyClass: 'INTERNAL',
      subject: { kind: 'test', id: 'd1' },
      actor: { kind: 'system', id: 'test' },
      correlationId: 'c-dupe',
      causationId: 'none',
      principalId: 'system',
      payload: {},
    });
    // simulate a redelivery/replay writing the same row
    await ctx.pg.sql.begin(async (tx) => {
      await k.eventStore.appendInTx(tx as never, [{ ...e }]);
    });
    expect(await k.eventStore.count()).toBe(1);
  });

  it('TRANSIENT events are published but never persisted', async () => {
    await truncateAll(ctx.pg);
    const k = ctx.makeKernel();
    const got: string[] = [];
    await k.bus.start();
    await k.bus.subscribe({
      consumer: 'transient-obs',
      subjects: ['jarvis.perception.>'],
      handler: async (e) => {
        got.push(e.id);
      },
    });
    const e = await k.events.emit({
      type: 'jarvis.perception.cursor.dwell',
      retentionClass: 'TRANSIENT',
      privacyClass: 'INTERNAL',
      subject: { kind: 'cursor', id: 'c' },
      actor: { kind: 'system', id: 'perception' },
      correlationId: k.ids.ulid(),
      causationId: 'none',
      principalId: 'system',
      payload: { x: 1 },
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(got).toContain(e.id);
    expect(await k.eventStore.count()).toBe(0);
  });

  it('reconstructs a causal tree by correlationId', async () => {
    await truncateAll(ctx.pg);
    const k = ctx.makeKernel();
    const corr = k.ids.ulid();
    const a = await k.events.emit({
      type: 'jarvis.kernel.test.a',
      retentionClass: 'OPERATIONAL',
      privacyClass: 'INTERNAL',
      subject: { kind: 'test', id: 'x' },
      actor: { kind: 'system', id: 'test' },
      correlationId: corr,
      causationId: 'none',
      principalId: 'system',
      payload: {},
    });
    await k.events.emit({
      type: 'jarvis.kernel.test.b',
      retentionClass: 'OPERATIONAL',
      privacyClass: 'INTERNAL',
      subject: { kind: 'test', id: 'x' },
      actor: { kind: 'system', id: 'test' },
      correlationId: corr,
      causationId: a.id,
      principalId: 'system',
      payload: {},
    });
    const tree = await k.eventStore.causalTree(corr);
    expect(tree.map((e) => e.type)).toEqual(['jarvis.kernel.test.a', 'jarvis.kernel.test.b']);
    expect(tree[1]!.causationId).toBe(a.id);
  });
});
