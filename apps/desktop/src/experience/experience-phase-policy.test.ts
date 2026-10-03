import { describe, expect, it } from 'vitest';
import type { JarvisOperatingPicture, OperatingModelRun } from '@jarvis/scene';
import { freezeFactor, requestFlow, resolveExperiencePhase, resolveLiveness } from './experience-phase-policy.ts';

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
