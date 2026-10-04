import { describe, expect, it } from 'vitest';
import type { JarvisOperatingPicture, SystemTelemetrySnapshot } from '@jarvis/scene';
import { attentionRegions, healthRegions, interpretTelemetry, peripheralSelection, REGION_INSTRUMENTS, trendOf } from './telemetry-instrument-policy.ts';

const now = Date.parse('2026-10-03T10:00:10Z');
const snapshot = (readings: SystemTelemetrySnapshot['readings'], generatedAt = '2026-10-03T10:00:05Z'): SystemTelemetrySnapshot => ({ generatedAt, window: '24h', overallHealth: 'healthy', readings, history: [] });
const reading = (value: number | null, unit = '%', status: 'available' | 'unavailable' | 'stale' = 'available') => ({ value, unit, status, observedAt: '2026-10-03T10:00:05Z' });
const byKey = (items: ReturnType<typeof interpretTelemetry>) => Object.fromEntries(items.map(item => [item.key, item]));

describe('telemetry instrument policy', () => {
  it('renders missing GPU telemetry as unavailable, never zero', () => {
    const gpu = byKey(interpretTelemetry(snapshot({ cpu: reading(40), gpu: reading(null, '%', 'unavailable') }), true, now)).gpu!;
    expect(gpu).toMatchObject({ status: 'unavailable', display: 'UNAVAILABLE' });
    expect(gpu.ratio).toBeUndefined();
  });
  it('withholds values when disconnected or older than thirty seconds', () => {
    expect(byKey(interpretTelemetry(snapshot({ cpu: reading(40) }), false, now)).cpu).toMatchObject({ status: 'stale', display: 'STALE' });
    expect(byKey(interpretTelemetry(snapshot({ cpu: reading(40) }, '2026-10-03T09:59:00Z'), true, now)).cpu!.value).toBeUndefined();
  });
  it('grades thresholds and binary connections', () => {
    const items = byKey(interpretTelemetry(snapshot({ ram: reading(95), postgres: reading(0, 'connected'), redis: reading(1, 'connected') }), true, now));
    expect(items.ram).toMatchObject({ status: 'critical', display: '95%', ratio: .95 });
    expect(items.postgres).toMatchObject({ status: 'critical', display: 'DOWN' });
    expect(items.redis).toMatchObject({ status: 'nominal', display: 'CONNECTED' });
  });
  it('auto-discloses: healthy idle shows nothing, an elevated compute reading discloses its instrument', () => {
    const healthy = interpretTelemetry(snapshot({ cpu: reading(10), ram: reading(30) }), true, now);
    expect(peripheralSelection(healthy, 'DORMANT')).toEqual([]);
    const hot = interpretTelemetry(snapshot({ cpu: reading(10), ram: reading(95) }), true, now);
    expect(peripheralSelection(hot, 'DORMANT').map(item => item.key)).toEqual(['ram']);
  });
  it('keeps region-bound failures beside their region and phase-relevant instruments while the phase lasts', () => {
    const items = interpretTelemetry(snapshot({ cpu: reading(10), postgres: reading(0, 'connected'), gatewayLatency: reading(840, 'ms') }), true, now);
    expect(peripheralSelection(items, 'DORMANT').map(item => item.key)).not.toContain('postgres');
    expect(REGION_INSTRUMENTS.storage).toContain('postgres');
    expect(peripheralSelection(items, 'MODEL_ACTIVE').map(item => item.key)).toContain('gatewayLatency');
  });
  it('lists only degraded or offline regions for attention', () => {
    expect(attentionRegions({ fabric: 'healthy', storage: 'offline', cache: 'unknown', gateway: 'degraded', voice: 'healthy', perception: 'unknown' })).toEqual(['gateway', 'storage']);
  });
  it('derives trends only from enough measured samples', () => {
    expect(trendOf([1, null])).toBe('unknown');
    expect(trendOf([1, 1, 1, 9, 9, 9])).toBe('up');
    expect(trendOf([5, 5, 5, 5])).toBe('flat');
  });
  it('localises health from diagnostics and leaves absent subsystems unknown', () => {
    const picture = { diagnostics: { dependencies: [{ name: 'nats', status: 'DEGRADED', placeholder: false }, { name: 'postgres', status: 'HEALTHY', placeholder: false }, { name: 'rtc', status: 'OFFLINE', placeholder: true }] } } as unknown as JarvisOperatingPicture;
    expect(healthRegions(picture, true)).toMatchObject({ fabric: 'degraded', storage: 'healthy', voice: 'unknown', gateway: 'unknown', perception: 'unknown' });
    expect(healthRegions(picture, false).storage).toBe('unknown');
  });
});
