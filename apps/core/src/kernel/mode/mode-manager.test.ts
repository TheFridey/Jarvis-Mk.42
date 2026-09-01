import { beforeEach, describe, expect, it } from 'vitest';
import { EventNames } from '@jarvis/contracts';
import { FakeEventManager, FakeStateManager } from '@jarvis/testkit';
import { FakeClock } from '../../runtime/clock.ts';
import { UlidGen } from '../../runtime/ids.ts';
import { ModeManager } from './mode-manager.ts';

function setup(guardOver: Partial<{ presencePresent: boolean; activeObjectiveCount: number; criticalDepsHealthy: boolean }> = {}) {
  const state = new FakeStateManager();
  const events = new FakeEventManager();
  const clock = new FakeClock(Date.parse('2026-09-01T00:00:00Z'));
  const mode = new ModeManager({
    state: state as unknown as ConstructorParameters<typeof ModeManager>[0]['state'],
    events: events as unknown as ConstructorParameters<typeof ModeManager>[0]['events'],
    clock,
    ids: new UlidGen(),
    minDwellMs: 5000,
    guardInputs: () => ({
      presencePresent: false,
      activeObjectiveCount: 1,
      criticalDepsHealthy: true,
      ...guardOver,
    }),
  });
  return { state, events, clock, mode };
}

describe('ModeManager', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('starts in DORMANT and moves to AMBIENT', async () => {
    expect(await ctx.mode.current()).toBe('DORMANT');
    const r = await ctx.mode.requestTransition('AMBIENT', 'operator_request', 'boot');
    expect(r.ok).toBe(true);
    expect(await ctx.mode.current()).toBe('AMBIENT');
  });

  it('emits jarvis.kernel.mode.changed on every accepted transition', async () => {
    await ctx.mode.requestTransition('AMBIENT', 'operator_request', 'boot');
    await ctx.mode.requestTransition('ENGAGED', 'interaction_started', 'user spoke');
    const changes = ctx.events.byType(EventNames.ModeChanged);
    expect(changes).toHaveLength(2);
    expect(changes[1]!.payload).toMatchObject({ from: 'AMBIENT', to: 'ENGAGED' });
  });

  it('rejects an illegal transition and emits nothing', async () => {
    const r = await ctx.mode.requestTransition('FOCUSED', 'focus_requested', 'nope');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('illegal_transition');
    expect(ctx.events.byType(EventNames.ModeChanged)).toHaveLength(0);
  });

  it('tags GUARDIAN transitions as SECURITY retention', async () => {
    await ctx.mode.requestTransition('AMBIENT', 'operator_request', 'boot');
    await ctx.mode.requestTransition('GUARDIAN', 'security_event', 'intrusion');
    const change = ctx.events.byType(EventNames.ModeChanged).at(-1)!;
    expect(change.retentionClass).toBe('SECURITY');
  });

  it('serialises concurrent transition requests (no interleaving)', async () => {
    await ctx.mode.requestTransition('AMBIENT', 'operator_request', 'boot');
    const [a, b] = await Promise.all([
      ctx.mode.requestTransition('ENGAGED', 'interaction_started', 'a'),
      ctx.mode.requestTransition('AUTONOMOUS', 'objective_activated', 'b'),
    ]);
    // exactly one of the two racing transitions from AMBIENT can win first;
    // the other is evaluated against the NEW current mode
    const results = [a, b];
    expect(results.filter((r) => r.ok).length).toBeGreaterThanOrEqual(1);
    // final mode is a legal value reached by a legal path
    expect(['ENGAGED', 'AUTONOMOUS', 'AMBIENT']).toContain(await ctx.mode.current());
  });

  it('honours the guard: cannot enter AUTONOMOUS while present', async () => {
    const c = setup({ presencePresent: true });
    await c.mode.requestTransition('AMBIENT', 'operator_request', 'boot');
    const r = await c.mode.requestTransition('AUTONOMOUS', 'objective_activated', 'x');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('guard_presence');
  });

  it('respects dwell hysteresis when leaving DEGRADED', async () => {
    const c = setup();
    await c.mode.requestTransition('DEGRADED', 'dependency_unhealthy', 'db down');
    // no time has passed -> dwell not elapsed
    const early = await c.mode.requestTransition('AMBIENT', 'dependency_recovered', 'db up');
    expect(early.ok).toBe(false);
    expect(early.code).toBe('guard_dwell');
    c.clock.advance(6000);
    const later = await c.mode.requestTransition('AMBIENT', 'dependency_recovered', 'db up');
    expect(later.ok).toBe(true);
  });
});
