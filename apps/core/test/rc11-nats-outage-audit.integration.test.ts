/**
 * RC1.1 EVENT FABRIC AUDIT — Kernel against a REAL nats-server.
 *
 * The pre-existing integration harness (`it-harness.ts`) forces
 * `forceInProcessBus: true`, so no test in the repository had ever exercised
 * the Kernel + JetStream + outbox recovery path end to end. This suite builds a
 * Kernel bound to a real NATS container and a real ephemeral PostgreSQL, then:
 *
 *  - AUDIT 3: kills the transport, exhausts retries on a bounded set of durable
 *    events, and proves durable-record growth is O(N) and converges — including
 *    that an `EventDeadLettered` cannot itself spawn another notification.
 *  - AUDIT 4: full outage/restart/drain cycle with duplicate detection and a
 *    check that mode never returns to AMBIENT while a critical dependency is
 *    unhealthy.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPg, runMigrations, type PgHandle } from '@jarvis/persistence';
import { startEphemeralNats, startEphemeralPg, type EphemeralNats, type EphemeralPg } from '@jarvis/testkit';
import { EventNames } from '@jarvis/contracts';
import { buildKernel, type KernelHandle } from '../src/kernel/lifecycle/kernel.ts';
import { loadConfig } from '../src/runtime/config.ts';
import { FakeClock } from '../src/runtime/clock.ts';
import { UlidGen } from '../src/runtime/ids.ts';

let nats: EphemeralNats | undefined;

let container: EphemeralPg | undefined;
let pg: PgHandle | undefined;
let natsUrl = '';
let clock: FakeClock;

async function waitFor(label: string, predicate: () => boolean | Promise<boolean>, ms = 30_000): Promise<void> {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${label}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

interface Counts {
  events: number;
  outboxPending: number;
  deadLetter: number;
  deadLetteredEvents: number;
}

async function counts(): Promise<Counts> {
  const [e] = await pg!.sql<{ c: string }[]>`select count(*)::text as c from events.events`;
  const [o] = await pg!.sql<{ c: string }[]>`select count(*)::text as c from events.outbox where dispatched_at is null`;
  const [d] = await pg!.sql<{ c: string }[]>`select count(*)::text as c from events.dead_letter`;
  const [n] = await pg!.sql<{ c: string }[]>`select count(*)::text as c from events.events where type = ${EventNames.EventDeadLettered}`;
  return {
    events: Number(e?.c ?? 0),
    outboxPending: Number(o?.c ?? 0),
    deadLetter: Number(d?.c ?? 0),
    deadLetteredEvents: Number(n?.c ?? 0),
  };
}

function makeKernel(overrides: Parameters<typeof buildKernel>[1] = {}, cfg: Partial<Parameters<typeof loadConfig>[0]> = {}): KernelHandle {
  const config = loadConfig({
    dbUrl: container!.url,
    natsEnabled: true,
    natsUrl,
    telemetryDisabled: true,
    redisUrl: '',
    diagnosticsPort: 0,
    outboxPollMs: 60_000, // ticks are driven manually for determinism
    outboxMaxAttempts: 2,
    modeMinDwellMs: 1,
    ...cfg,
  });
  return buildKernel(config, { pg: pg!, clock, ids: new UlidGen(), noHttp: true, noScheduler: true, ...overrides });
}

async function emitDurable(k: KernelHandle, i: number): Promise<void> {
  await k.events.emit({
    type: EventNames.SchedulerTick,
    retentionClass: 'OPERATIONAL',
    privacyClass: 'INTERNAL',
    subject: { kind: 'audit', id: `n-${i}` },
    actor: { kind: 'system', id: 'audit' },
    correlationId: `audit-${i}`,
    causationId: 'none',
    principalId: 'system',
    payload: { scheduleId: `audit-probe-${i}`, jobRunId: `run-${i}`, status: 'ok', attempt: 0 },
  });
}

async function truncateEventTables(): Promise<void> {
  await pg!.sql`truncate events.events, events.outbox, events.idempotency, events.dead_letter restart identity cascade`;
  await pg!.sql`delete from projections.state_slices`;
  await pg!.sql`update projections.state_meta set state_version = 0, checkpoint_event_id = null where id = 1`;
}

describe('RC1.1 audit - Kernel over real NATS', () => {
  beforeAll(async () => {
    container = await startEphemeralPg();
    pg = createPg({ url: container.url, statementTimeoutMs: 60_000 });
    await runMigrations(pg.sql);
    nats = await startEphemeralNats('jarvis-audit-k-nats');
    natsUrl = nats.url;
    clock = new FakeClock(Date.parse('2026-09-01T00:00:00.000Z'));
  }, 240_000);

  // Each test owns the transport state it needs; a previous failure must not
  // silently change what the next test is actually measuring.
  beforeEach(async () => {
    await nats!.start();
  }, 120_000);

  afterAll(async () => {
    await pg?.close().catch(() => undefined);
    await container?.stop().catch(() => undefined);
    await nats?.remove();
  }, 120_000);

  it('AUDIT-3: a permanent transport outage produces bounded O(N) durable records and cannot recurse', async () => {
    await truncateEventTables();
    const k = makeKernel();
    await k.start();
    expect(k.health.criticalDepsHealthy()).toBe(true);

    // Force the transport down and keep it down for the whole test.
    await nats!.stop();
    await waitFor('bus reports unhealthy', () => !k.bus.isHealthy(), 60_000);
    // Settle the Kernel's own start-up backlog first, so the measurement below
    // attributes growth to the N injected failures and nothing else.
    const drive = async (passes: number) => {
      for (let pass = 0; pass < passes; pass++) {
        clock.advance(60_000); // beyond any exponential backoff window
        await k.outboxRelay.tick();
      }
    };
    /** Drive until the outbox stops shrinking, so the proof does not depend on
     *  a hard-coded pass count matching whatever the Kernel emitted at start. */
    const driveToQuiescence = async (): Promise<void> => {
      let last = -1;
      for (let round = 0; round < 40; round++) {
        await drive(25);
        const pending = (await counts()).outboxPending;
        if (pending === 0) return;
        if (pending === last) throw new Error(`outbox stuck at ${pending} pending rows`);
        last = pending;
      }
      throw new Error('outbox did not reach quiescence');
    };
    await driveToQuiescence();
    const before = await counts();
    expect(before.outboxPending).toBe(0);

    const N = 12;
    for (let i = 0; i < N; i++) await emitDurable(k, i);
    expect((await counts()).events).toBe(before.events + N);

    // Every original event must exhaust retries, and every dead-letter
    // notification must then exhaust its own retries.
    await driveToQuiescence();
    const settled = await counts();

    // Continue driving well past quiescence; nothing may keep growing.
    await drive(150);
    const stable = await counts();

    console.log(`DLQ_SETTLED=${JSON.stringify(settled)}`);
    console.log(`DLQ_STABLE=${JSON.stringify(stable)}`);

    // The invariant: N source failures under a permanent outage must reach a
    // FIXED POINT, not merely grow slowly.
    expect(stable).toEqual(settled);
    expect(stable.outboxPending).toBe(0); // everything durable has been resolved
    // O(N): a small constant of fabric self-observations on top of the sources,
    // never a multiple that scales with how long the outage lasts.
    const CONSTANT = 8;
    expect(stable.events - before.events).toBeLessThanOrEqual(2 * N + CONSTANT);
    expect(stable.deadLetter - before.deadLetter).toBeLessThanOrEqual(2 * N + CONSTANT);
    expect(stable.deadLetteredEvents - before.deadLetteredEvents).toBeLessThanOrEqual(N + CONSTANT);

    // Direct recursion probe: every dead-lettered EventDeadLettered must have
    // produced no descendant notification of its own.
    const dl = await pg!.sql<{ type: string; c: string }[]>`
      select event->>'type' as type, count(*)::text as c from events.dead_letter group by 1 order by 1`;
    console.log(`DLQ_BY_TYPE=${JSON.stringify(dl)}`);
    const notificationsDeadLettered = Number(
      dl.find((r) => r.type === EventNames.EventDeadLettered)?.c ?? '0',
    );
    expect(notificationsDeadLettered).toBeGreaterThan(0); // the notifications themselves did fail
    const generations = await pg!.sql<{ c: string }[]>`
      select count(*)::text as c from events.events child
      join events.events parent on child.causation_id = parent.id
      where child.type = ${EventNames.EventDeadLettered} and parent.type = ${EventNames.EventDeadLettered}`;
    expect(Number(generations[0]?.c ?? '0')).toBe(0); // no second generation exists

    await k.stop();
    await nats!.start();
  }, 300_000);

  it('AUDIT-4: outage -> degrade -> restart -> drain, with no duplicates and health restored', async () => {
    await truncateEventTables();
    const k = makeKernel({}, { outboxPollMs: 100, outboxMaxAttempts: 50 });
    await k.start();
    await waitFor('bus healthy at start', () => k.bus.isHealthy());
    expect(await k.mode.current()).toBe('AMBIENT');

    const received: string[] = [];
    await k.bus.subscribe({
      consumer: `audit-drain-${Date.now()}`,
      subjects: [EventNames.SchedulerTick],
      handler: async (e) => {
        received.push(e.id);
      },
    });

    // 2. stop NATS
    await nats!.stop();
    await waitFor('bus reports unhealthy', () => !k.bus.isHealthy(), 60_000);
    const natsHealth = () => k.health.report().subsystems.find((s) => s.subsystem === 'nats')?.status;
    await waitFor('nats subsystem marked down', () => natsHealth() === 'OFFLINE' || natsHealth() === 'DEGRADED', 30_000);

    // 3. generate persistent events while the transport is down
    const N = 10;
    for (let i = 0; i < N; i++) await emitDurable(k, i);
    const duringOutage = await counts();
    expect(duringOutage.outboxPending).toBeGreaterThan(0);

    // 4. degrade safely: nothing is lost, everything is durable, nothing dead-lettered yet
    expect(duringOutage.deadLetter).toBe(0);
    console.log(`OUTAGE_STATE=${JSON.stringify({ ...duringOutage, natsHealth: natsHealth(), overall: k.health.report().overall, mode: await k.mode.current() })}`);

    // 5/6. restart NATS and confirm reconnection
    await nats!.start();
    await waitFor('bus reconnected', () => k.bus.isHealthy(), 120_000);
    await waitFor('nats subsystem healthy', () => natsHealth() === 'HEALTHY', 60_000);

    // 7. outbox drains
    await waitFor('outbox drained', async () => {
      clock.advance(60_000);
      await k.outboxRelay.tick().catch(() => undefined);
      return (await counts()).outboxPending === 0;
    }, 120_000);

    // 8. no duplicates and nothing dead-lettered
    await waitFor('all notifications delivered', () => received.length >= N, 60_000);
    await new Promise((r) => setTimeout(r, 1_000));
    expect(new Set(received).size).toBe(received.length);
    expect((await counts()).deadLetter).toBe(0);

    // 9/10. fabric healthy and the Kernel is in a healthy mode
    await k.health.heartbeat({ subsystem: 'event-fabric', status: 'HEALTHY', message: 'audit: drained' });
    expect(k.health.criticalDepsHealthy()).toBe(true);
    const finalMode = await k.mode.current();
    console.log(`RECOVERY_STATE=${JSON.stringify({ mode: finalMode, overall: k.health.report().overall, received: received.length, unique: new Set(received).size })}`);
    expect(finalMode).toBe('AMBIENT');

    await k.stop();
  }, 300_000);

  it('AUDIT-4b: the Kernel does not return to AMBIENT while a critical dependency is unhealthy', async () => {
    await truncateEventTables();
    const k = makeKernel();
    await k.start();
    expect(await k.mode.current()).toBe('AMBIENT');

    await k.health.heartbeat({ subsystem: 'event-fabric', status: 'DEGRADED', message: 'audit fault' });
    await k.health.heartbeat({ subsystem: 'agency', status: 'OFFLINE', message: 'audit fault' });
    expect(await k.mode.current()).toBe('DEGRADED');

    clock.advance(10_000);
    await k.health.heartbeat({ subsystem: 'event-fabric', status: 'HEALTHY', message: 'audit recovered' });
    expect(k.health.criticalDepsHealthy()).toBe(false);
    expect(await k.mode.current()).toBe('DEGRADED'); // must NOT return early

    clock.advance(10_000);
    await k.health.heartbeat({ subsystem: 'agency', status: 'HEALTHY', message: 'audit recovered' });
    expect(await k.mode.current()).toBe('AMBIENT');
    await k.stop();
  }, 180_000);
});
