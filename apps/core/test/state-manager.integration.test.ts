import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventNames, type StateSliceKey } from '@jarvis/contracts';
import { isDockerAvailable } from '@jarvis/testkit';
import { setupIt, truncateAll, type ItContext } from './it-harness.ts';

const dockerOk = await isDockerAvailable();

describe.skipIf(!dockerOk)('authoritative state manager (integration)', () => {
  let ctx: ItContext;

  beforeAll(async () => {
    ctx = await setupIt();
  }, 120_000);

  afterAll(async () => {
    await ctx?.cleanup();
  });

  async function freshKernel() {
    await truncateAll(ctx.pg);
    const k = ctx.makeKernel();
    await k.state.init();
    return k;
  }

  it('a client mutation bumps the slice version and the global stateVersion and emits state.mutated', async () => {
    const k = await freshKernel();
    const before = (await k.state.view()).stateVersion;
    const r = await k.state.mutate({
      key: 'active_workspace',
      value: { workspaceId: 'repo-1' },
      expectedVersion: 0,
      correlationId: k.ids.ulid(),
      actor: { kind: 'principal', id: 'principal-operator' },
      reason: 'user opened repo-1',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.newVersion).toBe(1);
      expect(r.stateVersion).toBe(before + 1);
    }
    const slice = await k.state.getSlice('active_workspace');
    expect(slice?.value).toEqual({ workspaceId: 'repo-1' });
    const events = await k.eventStore.readFrom('0', 50);
    expect(events.some((e) => e.type === EventNames.StateMutated)).toBe(true);
  });

  it('INVARIANT: two mutations against the same base version - exactly one is accepted', async () => {
    const k = await freshKernel();
    const results = await Promise.all([
      k.state.mutate({
        key: 'cursor_target',
        value: { ref: 'A' },
        expectedVersion: 0,
        correlationId: k.ids.ulid(),
        actor: { kind: 'principal', id: 'principal-operator' },
        reason: 'writer A',
      }),
      k.state.mutate({
        key: 'cursor_target',
        value: { ref: 'B' },
        expectedVersion: 0,
        correlationId: k.ids.ulid(),
        actor: { kind: 'principal', id: 'principal-operator' },
        reason: 'writer B',
      }),
    ]);
    const ok = results.filter((r) => r.ok);
    const conflict = results.filter((r) => !r.ok && r.code === 'version_conflict');
    expect(ok).toHaveLength(1);
    expect(conflict).toHaveLength(1);
    const slice = await k.state.getSlice('cursor_target');
    expect(slice?.version).toBe(1);
  });

  it('rejects an invalid value shape with validation_failed', async () => {
    const k = await freshKernel();
    const r = await k.state.mutate({
      key: 'presence',
      value: { state: 'HAPPY', confidence: 2 },
      expectedVersion: -1,
      correlationId: k.ids.ulid(),
      actor: { kind: 'system', id: 'test' },
      reason: 'bad',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('validation_failed');
  });

  it('forbids a client actor from writing a system-only slice', async () => {
    const k = await freshKernel();
    const r = await k.state.mutate({
      key: 'mode',
      value: { mode: 'AUTONOMOUS' },
      expectedVersion: -1,
      correlationId: k.ids.ulid(),
      actor: { kind: 'principal', id: 'principal-operator' },
      reason: 'client tries to force mode',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('forbidden_slice');
  });

  it('pushes StateUpdate to subscribers', async () => {
    const k = await freshKernel();
    const updates: string[] = [];
    const unsub = k.state.subscribe(['selected_object'], (u) => updates.push(u.key));
    await k.state.mutate({
      key: 'selected_object',
      value: { ref: 'file.ts' },
      expectedVersion: -1,
      correlationId: k.ids.ulid(),
      actor: { kind: 'principal', id: 'principal-operator' },
      reason: 'selection',
    });
    unsub();
    expect(updates).toEqual(['selected_object']);
  });

  it('rebuildStateFromEvents reproduces the exact slice values from the event log', async () => {
    const k = await freshKernel();
    const writes: [StateSliceKey, unknown][] = [
      ['active_workspace', { workspaceId: 'w1' }],
      ['selected_object', { ref: 'x' }],
      ['cursor_target', { ref: 'y' }],
      ['active_workspace', { workspaceId: 'w2' }],
    ];
    for (const [key, value] of writes) {
      const r = await k.state.mutate({
        key,
        value,
        expectedVersion: -1,
        correlationId: k.ids.ulid(),
        actor: { kind: 'principal', id: 'principal-operator' },
        reason: 'seed',
      });
      expect(r.ok).toBe(true);
    }
    const before = await k.state.view();

    const { replayed } = await k.rebuildStateFromEvents();
    expect(replayed).toBeGreaterThanOrEqual(writes.length);

    const after = await k.state.view();
    expect(after.slices.active_workspace.value).toEqual({ workspaceId: 'w2' });
    expect(after.slices.selected_object.value).toEqual({ ref: 'x' });
    expect(after.slices.cursor_target.value).toEqual({ ref: 'y' });
    // slice versions match what the event stream implies
    expect(after.slices.active_workspace.version).toBe(before.slices.active_workspace.version);
  });

  it('a Redis outage does not touch authoritative state (PostgreSQL is authority)', async () => {
    // The harness runs with redisUrl='' (NullEphemeralStore) - i.e. "Redis down".
    const k = await freshKernel();
    const r = await k.state.mutate({
      key: 'active_workspace',
      value: { workspaceId: 'survives' },
      expectedVersion: -1,
      correlationId: k.ids.ulid(),
      actor: { kind: 'principal', id: 'principal-operator' },
      reason: 'no redis',
    });
    expect(r.ok).toBe(true);
    // reopen a fresh manager against the same PG - value persisted
    const k2 = ctx.makeKernel();
    await k2.state.init();
    const slice = await k2.state.getSlice('active_workspace');
    expect(slice?.value).toEqual({ workspaceId: 'survives' });
  });
});
