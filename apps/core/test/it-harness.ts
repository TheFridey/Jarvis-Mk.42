/**
 * Integration harness: an ephemeral Postgres + a fresh migrated schema + a
 * Kernel wired to the in-process bus and a FakeClock. Used by the *.integration
 * tests, which self-skip when Docker is unavailable.
 */
import { createPg, runMigrations, type PgHandle } from '@jarvis/persistence';
import { startEphemeralPg, type EphemeralPg } from '@jarvis/testkit';
import { buildKernel, type KernelHandle } from '../src/kernel/lifecycle/kernel.ts';
import { loadConfig } from '../src/runtime/config.ts';
import { FakeClock } from '../src/runtime/clock.ts';
import { UlidGen } from '../src/runtime/ids.ts';

export interface ItContext {
  pg: PgHandle;
  container: EphemeralPg;
  clock: FakeClock;
  makeKernel(overrides?: Parameters<typeof buildKernel>[1]): KernelHandle;
  cleanup(): Promise<void>;
}

export async function setupIt(): Promise<ItContext> {
  const container = await startEphemeralPg();
  const pg = createPg({ url: container.url });
  await runMigrations(pg.sql);
  const clock = new FakeClock(Date.parse('2026-09-01T00:00:00.000Z'));

  const config = loadConfig({
    dbUrl: container.url,
    natsEnabled: false,
    telemetryDisabled: true,
    redisUrl: '',
    diagnosticsPort: 0,
    outboxPollMs: 25,
    modeMinDwellMs: 1,
  });

  const kernels: KernelHandle[] = [];
  function makeKernel(overrides: Parameters<typeof buildKernel>[1] = {}): KernelHandle {
    const k = buildKernel(config, {
      pg,
      clock,
      ids: new UlidGen(),
      forceInProcessBus: true,
      noHttp: true,
      noScheduler: true,
      ...overrides,
    });
    kernels.push(k);
    return k;
  }

  return {
    pg,
    container,
    clock,
    makeKernel,
    async cleanup() {
      for (const k of kernels) await k.stop().catch(() => undefined);
      await pg.close().catch(() => undefined);
      await container.stop().catch(() => undefined);
    },
  };
}

export async function truncateAll(pg: PgHandle): Promise<void> {
  await pg.sql`truncate events.events, events.outbox, events.idempotency, events.dead_letter,
                       projections.snapshots, agency.invocation_history, agency.invocations,
                       agency.approvals, agency.resource_leases, agency.grants,
                       agency.capability_versions, agency.capabilities restart identity cascade`;
  await pg.sql`delete from projections.state_slices`;
  await pg.sql`update projections.state_meta set state_version = 0, checkpoint_event_id = null where id = 1`;
}
