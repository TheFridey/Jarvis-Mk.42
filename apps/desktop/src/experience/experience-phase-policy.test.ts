import { describe, expect, it } from 'vitest';
import type { JarvisOperatingPicture, OperatingModelRun } from '@jarvis/scene';
import { coreWord, freezeFactor, latestFailure, requestFlow, resolveExperiencePhase, resolveLiveness } from './experience-phase-policy.ts';

const live = resolveLiveness({ status: 'live' }, false);
const picture = (patch: Partial<JarvisOperatingPicture> = {}) => ({ interactionState: 'DORMANT', workState: 'IDLE', systemHealth: { overall: 'HEALTHY' }, pendingApprovals: [], activeModels: [], activeCapabilities: [], ...patch } as unknown as JarvisOperatingPicture);
const run = (patch: Partial<OperatingModelRun>): OperatingModelRun => ({ requestId: 'r', correlationId: 'c', modelId: 'm', agentId: 'agents.nova', status: 'running', startedAt: '2026-10-03T10:00:00Z', ...patch });

describe('experience phase policy', () => {
  it('treats only live or explicit demo connections as current', () => {
    expect(resolveLiveness({ status: 'live' }, false).current).toBe(true);
    expect(resolveLiveness({ status: 'demo' }, true)).toMatchObject({ current: true, synthetic: true });
    expect(resolveLiveness({ status: 'stale' }, false).current).toBe(false);
  });
  it('shows communication loss instead of animating retained work', () => {
    const stale = resolveLiveness({ status: 'stale', staleSince: '2026-10-03T10:00:00Z' }, false);
    expect(resolveExperiencePhase(picture({ workState: 'THINKING' }), stale)).toBe('COMM_LOSS');
    expect(resolveExperiencePhase(undefined, stale)).toBe('UNAVAILABLE');
  });
  it('says STALE while reconnecting and COMM LOSS once disconnected', () => {
    expect(coreWord('COMM_LOSS', { status: 'reconnecting' })).toBe('STALE');
    expect(coreWord('COMM_LOSS', { status: 'stale' })).toBe('COMM LOSS');
    expect(coreWord('MODEL_ACTIVE', { status: 'live' })).toBe('INFERENCE');
  });
  it('freezes progressively after disconnection', () => {
    const since = Date.parse('2026-10-03T10:00:00Z');
    const stale = resolveLiveness({ status: 'stale', staleSince: '2026-10-03T10:00:00Z' }, false);
    expect(freezeFactor(live, since)).toBe(0);
    expect(freezeFactor(stale, since + 2000)).toBeGreaterThan(0);
    expect(freezeFactor(stale, since + 2000)).toBeLessThan(1);
    expect(freezeFactor(stale, since + 60_000)).toBe(1);
  });
  it('reserves CRITICAL for authoritative OFFLINE health', () => {
    expect(resolveExperiencePhase(picture({ systemHealth: { overall: 'OFFLINE' } as never }), live)).toBe('CRITICAL');
    expect(resolveExperiencePhase(picture({ workState: 'ERROR' }), live)).toBe('ERROR');
    expect(resolveExperiencePhase(picture({ systemHealth: { overall: 'DEGRADED' } as never }), live)).toBe('DEGRADED');
  });
  it('never claims model activity without an observed confirmed run', () => {
    expect(resolveExperiencePhase(picture({ workState: 'THINKING' }), live)).toBe('THINKING');
    expect(resolveExperiencePhase(picture({ workState: 'THINKING', activeModels: [run({ routing: { phase: 'STARTING' } as never })] }), live)).toBe('MODEL_ACTIVE');
    expect(resolveExperiencePhase(picture({ workState: 'THINKING', activeModels: [run({ activityConfirmed: false, routing: { phase: 'STARTING' } as never })] }), live)).toBe('THINKING');
  });
  it('shows fallback only when routing reports it', () => {
    expect(resolveExperiencePhase(picture({ workState: 'ROUTING', activeModels: [run({ routing: { phase: 'FALLBACK' } as never })] }), live)).toBe('FALLBACK');
    expect(resolveExperiencePhase(picture({ workState: 'ROUTING', activeModels: [run({ routing: { phase: 'CANDIDATE' } as never })] }), live)).toBe('ROUTING');
  });
  it('makes a pending approval the dominant barrier state', () => {
    expect(resolveExperiencePhase(picture({ workState: 'WAITING', pendingApprovals: [{ id: 'a' }] as never }), live)).toBe('APPROVAL');
  });
  it('never marks unsignalled flow stages as done', () => {
    const flow = requestFlow(picture({ workState: 'EXECUTING', activeCapabilities: [{ state: 'EXECUTING' }] as never }), 'EXECUTING');
    expect(flow.EXECUTE).toBe('active');
    expect(flow.CONTEXT).toBe('unobserved');
    expect(flow.POLICY).toBe('unobserved');
    expect(flow.VERIFY).toBe('pending');
  });
});

describe('work fault evidence freshness', () => {
  const now = Date.parse('2026-11-13T09:00:00Z');
  const failure = (ageMs: number) => ({ action: 'projects.read', state: 'FAILED', updatedAt: new Date(now - ageMs).toISOString() });
  const errorPicture = (activity: unknown[]) => picture({ workState: 'ERROR', capabilityActivity: activity as never });

  it('keeps ERROR while the failure is current', () => {
    expect(resolveExperiencePhase(errorPicture([failure(30_000)]), live, now)).toBe('ERROR');
  });

  it('stops calling a healthy system faulty once the failure is history', () => {
    expect(resolveExperiencePhase(errorPicture([failure(45 * 60 * 1000)]), live, now)).toBe('DORMANT');
    expect(resolveExperiencePhase(errorPicture([failure(45 * 60 * 1000)]), live, now)).not.toBe('ERROR');
  });

  it('trusts the work axis when the projection carries no ledger', () => {
    expect(resolveExperiencePhase(errorPicture([]), live, now)).toBe('ERROR');
  });

  it('never lets a historical failure outrank live activity', () => {
    const busy = picture({
      workState: 'EXECUTING',
      capabilityActivity: [failure(60 * 60 * 1000)] as never,
      activeCapabilities: [{ action: 'publish', state: 'EXECUTING' }] as never,
    });
    expect(resolveExperiencePhase(busy, live, now)).toBe('EXECUTING');
  });

  it('reports the most recent fault, not the first one it finds', () => {
    const older = { action: 'invoices.read', state: 'FAILED', updatedAt: new Date(now - 60 * 60 * 1000).toISOString() };
    const newer = { action: 'projects.read', state: 'VERIFICATION_FAILED', updatedAt: new Date(now - 60_000).toISOString() };
    expect(latestFailure({ capabilityActivity: [older, newer] }, now)).toMatchObject({ action: 'projects.read', state: 'VERIFICATION_FAILED', recent: true });
  });
});

describe('fault evidence without a timestamp', () => {
  const now = Date.parse('2026-11-13T09:00:00Z');
  it('assumes an undateable fault is current rather than hiding it', () => {
    const picture = { workState: 'ERROR' as const, capabilityActivity: [{ action: 'projects.read', state: 'FAILED' }] as never };
    expect(latestFailure(picture, now)).toMatchObject({ state: 'FAILED', recent: true });
    expect(resolveExperiencePhase(picture as never, live, now)).toBe('ERROR');
  });

  it('prefers a dated fault over an undated one', () => {
    const picture = { capabilityActivity: [{ state: 'FAILED' }, { action: 'x', state: 'FAILED', updatedAt: new Date(now - 86_400_000).toISOString() }] as never };
    expect(latestFailure(picture, now)).toMatchObject({ action: 'x', recent: false });
  });
});
