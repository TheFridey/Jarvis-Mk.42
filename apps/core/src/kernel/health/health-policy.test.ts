import { describe, expect, it } from 'vitest';
import type { SubsystemHealth } from '@jarvis/contracts';
import { computeOverall, degradationLevel } from './health-policy.ts';

const sub = (over: Partial<SubsystemHealth>): SubsystemHealth => ({
  subsystem: 's',
  status: 'HEALTHY',
  critical: false,
  dependsOn: [],
  message: '',
  updatedAt: '2026-09-01T00:00:00.000Z',
  ...over,
});

describe('health roll-up', () => {
  it('is STARTING with no subsystems', () => {
    expect(computeOverall([]).overall).toBe('STARTING');
  });

  it('worst CRITICAL status wins', () => {
    const r = computeOverall([
      sub({ subsystem: 'postgres', critical: true, status: 'HEALTHY' }),
      sub({ subsystem: 'event-fabric', critical: true, status: 'DEGRADED', message: 'outbox lag' }),
    ]);
    expect(r.overall).toBe('DEGRADED');
    expect(r.criticalIssues).toEqual(['event-fabric: DEGRADED - outbox lag']);
  });

  it('a CRITICAL OFFLINE takes the system OFFLINE', () => {
    const r = computeOverall([sub({ subsystem: 'postgres', critical: true, status: 'OFFLINE', message: 'gone' })]);
    expect(r.overall).toBe('OFFLINE');
  });

  it('a non-critical OFFLINE only nudges a healthy system to DEGRADED', () => {
    const r = computeOverall([
      sub({ subsystem: 'postgres', critical: true, status: 'HEALTHY' }),
      sub({ subsystem: 'redis', critical: false, status: 'OFFLINE' }),
    ]);
    expect(r.overall).toBe('DEGRADED');
    expect(r.criticalIssues).toEqual([]);
  });

  it('RECOVERING critical does not count as a critical issue', () => {
    const r = computeOverall([sub({ subsystem: 'postgres', critical: true, status: 'RECOVERING' })]);
    expect(r.overall).toBe('RECOVERING');
    expect(r.criticalIssues).toEqual([]);
  });

  it('maps overall -> degradation level', () => {
    expect(degradationLevel('HEALTHY')).toBe('nominal');
    expect(degradationLevel('DEGRADED')).toBe('degraded');
    expect(degradationLevel('OFFLINE')).toBe('critical');
    expect(degradationLevel('RECOVERING')).toBe('nominal');
  });
});
