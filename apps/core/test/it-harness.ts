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
  // If anything below fails or a hook timeout aborts this function partway
  // through, `ctx` in the calling test is never assigned, so `afterAll(() =>
  // ctx?.cleanup())` is a no-op and the ephemeral container leaks forever
  // (observed: a leaked container degraded the Docker daemon for later runs).
  // Guard every step after container creation so a partial failure still
  // tears the container down before the error propagates.
  try {
    // Parallel disposable containers can briefly contend for Docker Desktop I/O.
    // Keep database statements bounded, but allow enough headroom that host load
    // is not misclassified as an application-level transaction failure.
    const pg = createPg({ url: container.url, statementTimeoutMs: 60_000 });
    try {
      await runMigrations(pg.sql);
    } catch (err) {
      await pg.close().catch(() => undefined);
      throw err;
    }
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
  } catch (err) {
    await container.stop().catch(() => undefined);
    throw err;
  }
}

export async function truncateAll(pg: PgHandle): Promise<void> {
  await pg.sql`truncate events.events, events.outbox, events.idempotency, events.dead_letter,
                       projections.snapshots, agency.invocation_history, agency.invocations,
                       agency.approvals, agency.resource_leases, agency.grants,
                       agency.capability_versions, agency.capabilities restart identity cascade`;
  await pg.sql`truncate cognition.runs, projections.objective_history, projections.objectives restart identity cascade`;
  await pg.sql`truncate atlas.entities, atlas.entity_aliases, atlas.entity_relationships, atlas.facts,
                       atlas.facts_archive, atlas.evidence, atlas.conflicts, atlas.observations,
                       atlas.causal_hypotheses restart identity cascade`;
  await pg.sql`truncate mnemosyne.episodes, mnemosyne.semantic, mnemosyne.procedures, mnemosyne.preferences,
                       mnemosyne.candidates, mnemosyne.consolidation_runs, mnemosyne.insights restart identity cascade`;
  await pg.sql`delete from projections.state_slices`;
  await pg.sql`update projections.state_meta set state_version = 0, checkpoint_event_id = null where id = 1`;
}
