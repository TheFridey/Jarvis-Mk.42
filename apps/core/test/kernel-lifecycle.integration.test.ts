import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventNames } from '@jarvis/contracts';
import { isDockerAvailable } from '@jarvis/testkit';
import { setupIt, truncateAll, type ItContext } from './it-harness.ts';

const dockerOk = await isDockerAvailable();

describe.skipIf(!dockerOk)('kernel lifecycle (integration)', () => {
  let ctx: ItContext;

  beforeAll(async () => {
    ctx = await setupIt();
  }, 120_000);

  afterAll(async () => {
    await ctx?.cleanup();
  });

  it('cold starts to operational: DORMANT -> AMBIENT, diagnostics ok, bootstrap identity present', async () => {
    await truncateAll(ctx.pg);
    const k = ctx.makeKernel();
    await k.start();

    expect(await k.mode.current()).toBe('AMBIENT');

    const report = await k.diagnostics.report();
    expect(report.ok).toBe(true);
    expect(report.mode).toBe('AMBIENT');
    expect(report.health.overall).not.toBe('OFFLINE');
    expect(report.events.deadLettered).toBe(0);
    expect(report.dependencies.find((d) => d.name === 'model-gateway')?.placeholder).toBe(true);
    expect(report.objectives.placeholder).toBe(true);

    // operational event on the log
    const events = await k.eventStore.readFrom('0', 200);
    expect(events.some((e) => e.type === EventNames.KernelOperational)).toBe(true);
    expect(events.some((e) => e.type === EventNames.ModeChanged)).toBe(true);
    expect(events.some((e) => e.type === EventNames.IdentityAuthenticated || e.type === EventNames.StateMutated)).toBe(true);

    await k.stop();
  });

  it('survives a restart: a second Kernel against the same PG recovers state + mode', async () => {
    await truncateAll(ctx.pg);
    const k1 = ctx.makeKernel();
    await k1.start();
    // do some authoritative work
    await k1.state.mutate({
      key: 'active_workspace',
      value: { workspaceId: 'persisted-across-restart' },
      expectedVersion: -1,
      correlationId: k1.ids.ulid(),
      actor: { kind: 'principal', id: 'principal-operator' },
      reason: 'work',
    });
    const svBefore = (await k1.state.view()).stateVersion;
    await k1.stop(); // takes a final snapshot

    const k2 = ctx.makeKernel();
    await k2.start();
    const view = await k2.state.view();
    expect(view.slices.active_workspace.value).toEqual({ workspaceId: 'persisted-across-restart' });
    expect(view.stateVersion).toBeGreaterThanOrEqual(svBefore);
    expect(await k2.mode.current()).toBe('AMBIENT');
    await k2.stop();
  });

  it('enters DEGRADED mode when a critical subsystem reports unhealthy, and recovers', async () => {
    await truncateAll(ctx.pg);
    const k = ctx.makeKernel();
    await k.start();
    expect(await k.mode.current()).toBe('AMBIENT');

    await k.health.heartbeat({ subsystem: 'event-fabric', status: 'DEGRADED', message: 'simulated' });
    // health.onChange -> reconcileModeWithHealth
    await new Promise((r) => setTimeout(r, 20));
    expect(await k.mode.current()).toBe('DEGRADED');

    ctx.clock.advance(10); // clear dwell hysteresis (harness minDwellMs=1)
    await k.health.heartbeat({ subsystem: 'event-fabric', status: 'HEALTHY', message: 'recovered' });
    await new Promise((r) => setTimeout(r, 20));
    expect(await k.mode.current()).toBe('AMBIENT');

    await k.stop();
  });

  it('the diagnostics report answers "I am operational" with real numbers', async () => {
    await truncateAll(ctx.pg);
    const k = ctx.makeKernel();
    await k.start();
    // generate some events
    for (let i = 0; i < 3; i++) {
      await k.state.mutate({
        key: 'selected_object',
        value: { ref: `r${i}` },
        expectedVersion: -1,
        correlationId: k.ids.ulid(),
        actor: { kind: 'principal', id: 'principal-operator' },
        reason: 'n',
      });
    }
    const report = await k.diagnostics.report();
    expect(report.events.totalAppended).toBeGreaterThan(3);
    expect(report.state.stateVersion).toBeGreaterThan(3);
    expect(report.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(report.identity.version).toBe('0.43.0');
    await k.stop();
  });
});
