import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HealthStatus } from '@jarvis/contracts';
import { NatsFabricHealthCoordinator } from './nats-fabric-health.ts';

describe('NatsFabricHealthCoordinator', () => {
  afterEach(() => vi.useRealTimers());

  function fixture(options: { pending?: number; heartbeatFails?: boolean } = {}) {
    vi.useFakeTimers();
    let now = Date.parse('2026-09-09T12:00:00.000Z');
    let pending = options.pending ?? 0;
    const heartbeats: Array<{ subsystem: string; status: HealthStatus; message: string }> = [];
    const errors: string[] = [];
    let retries = 0;
    let verifications = 0;
    const coordinator = new NatsFabricHealthCoordinator({
      degradeAfterMs: 100,
      nowMs: () => now,
      heartbeat: async (subsystem, status, message) => {
        heartbeats.push({ subsystem, status, message });
        if (options.heartbeatFails) throw new Error('listener exploded');
      },
      verifyTransport: async () => { verifications++; },
      releaseOutboxForRecovery: async () => undefined,
      pendingOutbox: async () => pending,
      retryConnect: async () => { retries++; },
      reportError: (message) => errors.push(message),
    });
    const advance = async (ms: number) => {
      now += ms;
      await vi.advanceTimersByTimeAsync(ms);
    };
    return { coordinator, heartbeats, errors, advance, setPending: (value: number) => { pending = value; }, retries: () => retries, verifications: () => verifications };
  }

  it('absorbs a short outage without degrading the critical event fabric', async () => {
    const f = fixture();
    await f.coordinator.transportUnavailable('disconnect');
    await f.advance(50);
    await f.coordinator.transportAvailable('reconnect');
    await f.advance(100);

    expect(f.heartbeats).not.toContainEqual(expect.objectContaining({ subsystem: 'event-fabric', status: 'DEGRADED' }));
    expect(f.coordinator.diagnostics().phase).toBe('HEALTHY');
    expect(f.verifications()).toBe(1);
    await f.coordinator.stop();
  });

  it('degrades after the grace period and requires relay evidence when backlog exists', async () => {
    const f = fixture({ pending: 4 });
    await f.coordinator.transportUnavailable('disconnect');
    await f.advance(100);
    expect(f.coordinator.diagnostics().phase).toBe('SUSTAINED_OUTAGE');
    expect(f.heartbeats).toContainEqual(expect.objectContaining({ subsystem: 'event-fabric', status: 'DEGRADED' }));

    await f.coordinator.transportAvailable('reconnect');
    expect(f.coordinator.diagnostics().waitingForRelayEvidence).toBe(true);
    expect(f.coordinator.diagnostics().phase).toBe('RECOVERING');
    await f.coordinator.relayHealthy('outbox draining');
    expect(f.coordinator.diagnostics().phase).toBe('HEALTHY');
    expect(f.coordinator.diagnostics().lastRelaySuccessAt).not.toBeNull();
    await f.coordinator.stop();
  });

  it('gives startup and runtime sustained outages the same fixed posture', async () => {
    const startup = fixture();
    await startup.coordinator.transportUnavailable('connect refused', true);
    await startup.advance(100);
    const runtime = fixture();
    await runtime.coordinator.transportUnavailable('disconnect');
    await runtime.advance(100);

    expect(startup.coordinator.diagnostics().phase).toBe('SUSTAINED_OUTAGE');
    expect(runtime.coordinator.diagnostics().phase).toBe('SUSTAINED_OUTAGE');
    expect(startup.heartbeats.at(-1)).toMatchObject({ subsystem: 'event-fabric', status: 'DEGRADED' });
    expect(runtime.heartbeats.at(-1)).toMatchObject({ subsystem: 'event-fabric', status: 'DEGRADED' });
    expect(startup.retries()).toBeGreaterThan(0);
    await startup.coordinator.stop();
    await runtime.coordinator.stop();
  });

  it('cancels flapping timers and does not multiply retry loops', async () => {
    const f = fixture();
    for (let i = 0; i < 5; i++) {
      await f.coordinator.transportUnavailable(`disconnect-${i}`, true);
      await f.advance(20);
      await f.coordinator.transportAvailable(`reconnect-${i}`);
    }
    await f.advance(200);

    expect(f.coordinator.diagnostics().phase).toBe('HEALTHY');
    expect(f.heartbeats.filter((h) => h.subsystem === 'event-fabric' && h.status === 'DEGRADED')).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    await f.coordinator.stop();
  });

  it('contains health-listener failures and exposes them diagnostically', async () => {
    const f = fixture({ heartbeatFails: true });
    await expect(f.coordinator.transportUnavailable('disconnect')).resolves.toBeUndefined();
    await f.advance(100);

    expect(f.errors.length).toBeGreaterThan(0);
    expect(f.coordinator.diagnostics().lastError).toContain('health reconciliation failed');
    expect(f.coordinator.diagnostics().phase).toBe('SUSTAINED_OUTAGE');
    await f.coordinator.stop();
  });
});
