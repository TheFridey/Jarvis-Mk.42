import { describe, expect, it } from 'vitest';
import type { JarvisOperatingPicture, OperatingModelRun } from '@jarvis/scene';
import { classifyFailure, coreWord, freezeFactor, latestFailure, requestFlow, resolveExperiencePhase, resolveLiveness } from './experience-phase-policy.ts';

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

  it('an old failure with no recovery evidence is degraded, not healthy and not a live fault', () => {
    const phase = resolveExperiencePhase(errorPicture([failure(45 * 60 * 1000)]), live, now);
    expect(phase).toBe('DEGRADED');
    expect(phase).not.toBe('ERROR');
  });

  it('an old failure superseded by a later success of the same action is history', () => {
    const recovered = [...[failure(45 * 60 * 1000)], { action: 'projects.read', state: 'VERIFIED', updatedAt: new Date(now - 20 * 60 * 1000).toISOString() }];
    expect(resolveExperiencePhase(errorPicture(recovered), live, now)).toBe('DORMANT');
    expect(classifyFailure(errorPicture(recovered) as never, now)).toMatchObject({ status: 'historical', recoveredBy: 'VERIFIED' });
  });

  it('an old failure on a degraded platform stays unresolved', () => {
    const degraded = { ...picture({ workState: 'ERROR', capabilityActivity: [failure(45 * 60 * 1000)] as never }), systemHealth: { overall: 'DEGRADED', dependencies: [{ name: 'postgres', status: 'DEGRADED' }] } };
    expect(classifyFailure(degraded as never, now)).toMatchObject({ status: 'unresolved' });
    expect(resolveExperiencePhase(degraded as never, live, now)).toBe('DEGRADED');
  });

  it('a verification outcome on a healthy platform is an outcome, not an incident', () => {
    const outcome = [{ action: 'clients.read', state: 'VERIFICATION_FAILED', updatedAt: new Date(now - 45 * 60 * 1000).toISOString() }];
    expect(classifyFailure(errorPicture(outcome) as never, now)).toMatchObject({ status: 'outcome' });
    expect(resolveExperiencePhase(errorPicture(outcome), live, now)).toBe('DORMANT');
  });

  it('a failure after a success is a live fault again', () => {
    const activity = [
      { action: 'projects.read', state: 'VERIFIED', updatedAt: new Date(now - 30 * 60 * 1000).toISOString() },
      { action: 'projects.read', state: 'FAILED', updatedAt: new Date(now - 10 * 60 * 1000).toISOString() },
    ];
    expect(classifyFailure(errorPicture(activity) as never, now)).toMatchObject({ status: 'unresolved' });
    const recent = [...activity, { action: 'projects.write', state: 'FAILED', updatedAt: new Date(now - 5_000).toISOString() }];
    expect(resolveExperiencePhase(errorPicture(recent), live, now)).toBe('ERROR');
  });

  it('active work outranks a historical failure', () => {
    const activity = [failure(45 * 60 * 1000)];
    expect(resolveExperiencePhase({ ...picture({ workState: 'EXECUTING', capabilityActivity: activity as never }) } as never, live, now)).toBe('EXECUTING');
  });

  it('malformed timestamps are treated as current, never as recovery', () => {
    const malformed = { action: 'projects.read', state: 'FAILED', updatedAt: 'not-a-date' };
    expect(classifyFailure(errorPicture([malformed]) as never, now)).toMatchObject({ status: 'active', recent: true });
  });

  it('a disconnected observation never renders a work verdict', () => {
    const offline = { status: 'offline' as const, current: false, synthetic: false, label: 'KERNEL OFFLINE' };
    expect(resolveExperiencePhase(errorPicture([failure(30_000)]), offline, now)).toBe('COMM_LOSS');
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
    expect(latestFailure(picture, now)).toMatchObject({ state: 'FAILED', recent: true, status: 'active' });
    expect(resolveExperiencePhase(picture as never, live, now)).toBe('ERROR');
  });

  it('prefers a dated fault over an undated one', () => {
    const picture = { capabilityActivity: [{ state: 'FAILED' }, { action: 'x', state: 'FAILED', updatedAt: new Date(now - 86_400_000).toISOString() }] as never };
    expect(latestFailure(picture, now)).toMatchObject({ action: 'x', recent: false });
  });
});
