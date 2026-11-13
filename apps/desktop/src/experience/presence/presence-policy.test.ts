import { describe, expect, it } from 'vitest';
import type { OperatingAgentJob } from '@jarvis/scene';
import type { DataLiveness, ExperiencePhase } from '../experience-phase-policy.ts';
import {
  COMMAND_MODE_KEY, PRESENCE_MODE_KEY, PRESENCE_MODE_STORAGE,
  presenceChrome, presenceComposition, presenceDetail, presenceInputEnabled, presenceMotion,
  presenceReadout, presenceSatellites, presenceTone, presenceVoiceStatus, presenceWord, presenceZones,
  resolvePresenceState, speechObserved, verifiedEvidence,
} from './presence-policy.ts';

const live = (over: Partial<DataLiveness> = {}): DataLiveness => ({ status: 'live', current: true, synthetic: false, label: 'REALTIME LIVE', ...over });
const stale = (over: Partial<DataLiveness> = {}): DataLiveness => ({ status: 'reconnecting', current: false, synthetic: false, staleSince: Date.now() - 5000, label: 'RECONNECTING · DATA STALE', ...over });

function job(over: Partial<OperatingAgentJob> & { jobId: string; agentId: string }): OperatingAgentJob {
  return { correlationId: 'c1', taskClass: 'analysis', state: 'RUNNING', attempt: 1, deadline: '2030-01-01T00:00:00.000Z', budget: { wallMs: 1000, contextUnits: 10, costLimit: 0 }, proposalCount: 0, proposedCapabilities: [], evidenceRefs: [], ...over };
}

const ALL_PHASES: ExperiencePhase[] = [
  'UNAVAILABLE', 'COMM_LOSS', 'CRITICAL', 'DORMANT', 'AWARE', 'LISTENING', 'INTERPRETING', 'RESPONDING',
  'THINKING', 'ROUTING', 'MODEL_ACTIVE', 'FALLBACK', 'APPROVAL', 'EXECUTING', 'VERIFYING', 'COMPLETE',
  'WAITING', 'BLOCKED', 'ERROR', 'DEGRADED',
];

describe('presence state mapping', () => {
  it('maps every experience phase to exactly one presence state', () => {
    const expected: Record<ExperiencePhase, string> = {
      UNAVAILABLE: 'DISCONNECTED', COMM_LOSS: 'DISCONNECTED', CRITICAL: 'FAULT',
      DORMANT: 'STANDBY', AWARE: 'STANDBY', DEGRADED: 'STANDBY', WAITING: 'STANDBY',
      LISTENING: 'LISTENING', INTERPRETING: 'THINKING', RESPONDING: 'SPEAKING',
      THINKING: 'THINKING', ROUTING: 'THINKING', MODEL_ACTIVE: 'THINKING', FALLBACK: 'THINKING',
      APPROVAL: 'APPROVAL', EXECUTING: 'EXECUTING', VERIFYING: 'EXECUTING', COMPLETE: 'VERIFIED',
      BLOCKED: 'FAULT', ERROR: 'FAULT',
    };
    for (const phase of ALL_PHASES) {
      expect(resolvePresenceState({ phase, liveness: live() }), phase).toBe(expected[phase]);
    }
  });

  it('gives every state a word, a tone and a non-empty truth line', () => {
    for (const phase of ALL_PHASES) {
      const state = resolvePresenceState({ phase, liveness: live() });
      expect(presenceWord(state, live()).length, phase).toBeGreaterThan(0);
      expect(presenceTone(state)).toBeTruthy();
      expect(presenceDetail({ phase, liveness: live() }).length, phase).toBeGreaterThan(0);
    }
  });

  it('lets a pending approval outrank executing work', () => {
    expect(resolvePresenceState({ phase: 'EXECUTING', liveness: live(), picture: { pendingApprovals: [{ action: 'DELETE', riskClass: 'HIGH' }] } })).toBe('APPROVAL');
    expect(resolvePresenceState({ phase: 'THINKING', liveness: live(), picture: { pendingApprovals: [{ summary: 'write' }] } })).toBe('APPROVAL');
  });

  it('keeps executing and completion above measured speech', () => {
    expect(resolvePresenceState({ phase: 'EXECUTING', liveness: live(), picture: { voiceAudio: { tts: 'playing' } } })).toBe('EXECUTING');
    expect(resolvePresenceState({ phase: 'COMPLETE', liveness: live(), picture: { voiceAudio: { tts: 'playing' } } })).toBe('VERIFIED');
  });

  it('reports speaking only when audio playback is freshly observed', () => {
    const now = Date.now();
    expect(resolvePresenceState({ phase: 'DORMANT', liveness: live(), now, picture: { voiceAudio: { tts: 'playing', observedAt: new Date(now - 400).toISOString() } } })).toBe('SPEAKING');
    expect(resolvePresenceState({ phase: 'DORMANT', liveness: live(), now, picture: { voiceAudio: { tts: 'idle', observedAt: new Date(now - 400).toISOString() } } })).toBe('STANDBY');
    // A tts flag with no timestamp cannot establish audio.
    expect(resolvePresenceState({ phase: 'DORMANT', liveness: live(), now, picture: { voiceAudio: { tts: 'playing' } } })).toBe('STANDBY');
  });

  it('cannot keep claiming speech from a stale observation', () => {
    const now = Date.now();
    const stale = { voiceAudio: { tts: 'playing', observedAt: new Date(now - 30_000).toISOString() } };
    expect(speechObserved(stale, now)).toBe(false);
    expect(resolvePresenceState({ phase: 'DORMANT', liveness: live(), now, picture: stale })).toBe('STANDBY');
    expect(resolvePresenceState({ phase: 'RESPONDING', liveness: live(), now, picture: stale })).toBe('SPEAKING');
    expect(presenceDetail({ phase: 'RESPONDING', liveness: live(), now, picture: stale })).toBe('Response in progress.');
  });

  it('does not call a text response audible speech', () => {
    const now = Date.now();
    const readout = presenceReadout({ phase: 'RESPONDING', liveness: live(), now });
    expect(readout.state).toBe('SPEAKING');
    expect(readout.speaking).toBe(false);
    expect(readout.word).toBe('RESPONDING');
    const audible = presenceReadout({ phase: 'RESPONDING', liveness: live(), now, picture: { voiceAudio: { tts: 'playing', observedAt: new Date(now - 200).toISOString() } } });
    expect(audible.word).toBe('SPEAKING');
    expect(audible.speaking).toBe(true);
  });

  it('never claims verified completion from a model run alone', () => {
    expect(resolvePresenceState({ phase: 'MODEL_ACTIVE', liveness: live() })).toBe('THINKING');
    expect(resolvePresenceState({ phase: 'COMPLETE', liveness: live() })).toBe('VERIFIED');
  });
});

describe('disconnected and stale behaviour', () => {
  it('is DISCONNECTED whenever the observation is not current', () => {
    expect(resolvePresenceState({ phase: 'EXECUTING', liveness: stale() })).toBe('DISCONNECTED');
    expect(presenceWord('DISCONNECTED', stale())).toBe('STALE');
    expect(presenceWord('DISCONNECTED', live({ status: 'offline', current: false }))).toBe('DISCONNECTED');
  });

  it('says the data age and that decisions are unavailable', () => {
    const detail = presenceDetail({ phase: 'EXECUTING', liveness: stale() });
    expect(detail).toContain('Decisions are unavailable');
    expect(presenceDetail({ phase: 'UNAVAILABLE', liveness: live({ status: 'offline', current: false }) })).toContain('No authoritative state');
  });

  it('keeps approvals visible while disabling the decision controls', () => {
    const chrome = presenceChrome({ approvals: 2, liveness: stale() });
    expect(chrome.showApprovals).toBe(true);
    expect(chrome.decisionsAllowed).toBe(false);
    expect(chrome.authoritativeTextAlwaysVisible).toBe(true);
  });

  it('disables input in synthetic demo mode', () => {
    expect(presenceInputEnabled({ liveness: live() })).toBe(true);
    expect(presenceInputEnabled({ liveness: live({ status: 'demo', synthetic: true }) })).toBe(false);
    expect(presenceInputEnabled({ liveness: stale() })).toBe(false);
  });
});

describe('approval accessibility', () => {
  it('never hides an approval behind a calmer state', () => {
    for (const phase of ALL_PHASES) {
      const chrome = presenceChrome({ approvals: 1, liveness: live() });
      expect(chrome.showApprovals, phase).toBe(true);
      expect(chrome.decisionsAllowed, phase).toBe(true);
    }
  });

  it('names the action, risk and backlog in the truth line', () => {
    const detail = presenceDetail({ phase: 'APPROVAL', liveness: live(), picture: { pendingApprovals: [{ action: 'PUBLISH', riskClass: 'CRITICAL' }, { action: 'MERGE' }] } });
    expect(detail).toContain('PUBLISH');
    expect(detail).toContain('CRITICAL risk');
    expect(detail).toContain('+1 more');
  });

  it('falls back to the summary when no action is declared', () => {
    expect(presenceDetail({ phase: 'APPROVAL', liveness: live(), picture: { pendingApprovals: [{ summary: 'restart service' }] } })).toContain('restart service');
  });
});

describe('reduced motion and graphics fallback', () => {
  it('stops continuous motion without changing the state', () => {
    const motion = presenceMotion(true, 'THINKING');
    expect(motion.ambient).toBe(0);
    expect(motion.satellitesAnimated).toBe(false);
    expect(resolvePresenceState({ phase: 'THINKING', liveness: live() })).toBe('THINKING');
  });

  it('keeps ambient motion bounded per state when motion is allowed', () => {
    for (const phase of ALL_PHASES) {
      const state = resolvePresenceState({ phase, liveness: live() });
      const motion = presenceMotion(false, state);
      expect(motion.ambient).toBeGreaterThanOrEqual(0);
      expect(motion.ambient).toBeLessThanOrEqual(1);
    }
  });

  it('keeps the authoritative text independent of the renderer', () => {
    const chrome = presenceChrome({ approvals: 0, liveness: live() });
    expect(chrome.authoritativeTextAlwaysVisible).toBe(true);
    expect(presenceWord('STANDBY', live())).toBe('STANDBY');
    expect(presenceDetail({ phase: 'DORMANT', liveness: live() })).toBe('Standing by.');
  });
});

describe('presence navigation', () => {
  it('keeps the command centre reachable from every state', () => {
    for (const phase of ALL_PHASES) {
      const state = resolvePresenceState({ phase, liveness: live() });
      expect(presenceChrome({ approvals: 0, liveness: live() }).commandCentreReachable, state).toBe(true);
    }
    expect(COMMAND_MODE_KEY).toBe('c');
    expect(PRESENCE_MODE_KEY).toBe('p');
    expect(PRESENCE_MODE_STORAGE.startsWith('jarvis:')).toBe(true);
  });
});

describe('presence composition', () => {
  it('frames a dominant orb with a clear readout horizon', () => {
    const desktop = presenceComposition({ width: 1856, height: 890 });
    // Large enough to dominate, small enough to leave a real response surface.
    expect(desktop.coreRadius).toBeGreaterThan(890 * .24);
    expect(desktop.coreRadius).toBeLessThan(890 * .34);
    expect(desktop.layout.core.x).toBe(928);
    expect(desktop.coreRadius * 2).toBeLessThan(desktop.layout.height);
    expect(desktop.horizon).toBeGreaterThan(desktop.layout.core.y + desktop.coreRadius * .9);
    expect(desktop.horizon).toBeLessThan(desktop.layout.height);
  });

  it('keeps satellites inside the viewport on narrow screens', () => {
    const narrow = presenceComposition({ width: 390, height: 844 });
    expect(narrow.layout.narrow).toBe(true);
    const satellites = presenceSatellites([job({ jobId: 'j1', agentId: 'agents.forge' })], {
      core: narrow.layout.core, radius: narrow.satelliteRadius, current: true,
    });
    for (const satellite of satellites) {
      expect(satellite.point.x).toBeGreaterThan(0);
      expect(satellite.point.x).toBeLessThan(narrow.layout.width);
      expect(satellite.point.y).toBeGreaterThan(0);
      expect(satellite.point.y).toBeLessThan(narrow.layout.height);
    }
  });

  it('grows the orb with the viewport and never with model count', () => {
    const small = presenceComposition({ width: 1280, height: 720 });
    const large = presenceComposition({ width: 2560, height: 1440 });
    expect(large.coreRadius).toBeGreaterThan(small.coreRadius);
    expect(presenceComposition({ width: 1280, height: 720 }).layout.models).toEqual([]);
    expect(presenceComposition({ width: 1280, height: 720 }).layout.agents).toEqual([]);
  });
});

describe('satellite agents', () => {
  it('shows nothing when the projection carries no jobs', () => {
    expect(presenceSatellites([], { core: { x: 400, y: 400 }, radius: 260, current: true })).toEqual([]);
  });

  it('keeps identity stable regardless of observation order', () => {
    const a = job({ jobId: 'j1', agentId: 'agents.forge' });
    const b = job({ jobId: 'j2', agentId: 'agents.scout' });
    const orbit = { core: { x: 400, y: 400 }, radius: 260, current: true };
    const forward = presenceSatellites([a, b], orbit);
    const reversed = presenceSatellites([b, a], orbit);
    expect(forward.map(satellite => satellite.agentId)).toEqual(reversed.map(satellite => satellite.agentId));
    expect(forward[0]!.point).toEqual(reversed[0]!.point);
  });

  it('removes a satellite when its job reaches a terminal state', () => {
    const orbit = { core: { x: 400, y: 400 }, radius: 260, current: true };
    const running = presenceSatellites([job({ jobId: 'j1', agentId: 'agents.forge', state: 'RUNNING' })], orbit);
    expect(running).toHaveLength(1);
    const complete = presenceSatellites([job({ jobId: 'j1', agentId: 'agents.forge', state: 'COMPLETE', finishedAt: '2026-01-01T00:00:00.000Z' })], orbit);
    expect(complete).toHaveLength(0);
    const failed = presenceSatellites([job({ jobId: 'j1', agentId: 'agents.forge', state: 'FAILED' })], orbit);
    expect(failed).toHaveLength(0);
  });

  it('never animates a satellite without a confirmed, current lease', () => {
    const orbit = { core: { x: 400, y: 400 }, radius: 260, current: true };
    const unconfirmed = presenceSatellites([job({ jobId: 'j1', agentId: 'agents.forge', activityConfirmed: false })], orbit);
    expect(unconfirmed[0]!.animated).toBe(false);
    const staleOrbit = presenceSatellites([job({ jobId: 'j1', agentId: 'agents.forge' })], { ...orbit, current: false });
    expect(staleOrbit[0]!.animated).toBe(false);
    const reduced = presenceSatellites([job({ jobId: 'j1', agentId: 'agents.forge' })], { ...orbit, reducedMotion: true });
    expect(reduced[0]!.animated).toBe(false);
  });

  it('preserves the parent relationship and job count', () => {
    const parent = job({ jobId: 'j1', agentId: 'agents.hermes' });
    const child = job({ jobId: 'j2', agentId: 'agents.forge', parentJobId: 'j1' });
    const twins = job({ jobId: 'j3', agentId: 'agents.forge' });
    const satellites = presenceSatellites([parent, child, twins], { core: { x: 400, y: 400 }, radius: 260, current: true });
    const forge = satellites.find(satellite => satellite.agentId === 'agents.forge')!;
    expect(forge.parentAgentId).toBe('agents.hermes');
    expect(forge.jobCount).toBe(2);
  });

  it('caps the field at six identities', () => {
    const jobs = Array.from({ length: 10 }, (_, index) => job({ jobId: `j${index}`, agentId: `agents.agent${String(index).padStart(2, '0')}` }));
    expect(presenceSatellites(jobs, { core: { x: 400, y: 400 }, radius: 260, current: true })).toHaveLength(6);
  });
});

describe('verified completion requires canonical evidence', () => {
  it('accepts a successful invocation ledger entry', () => {
    const now = Date.now();
    const stamp = new Date(now - 20_000).toISOString();
    const picture = { capabilityActivity: [{ action: 'publish', state: 'EXECUTING', updatedAt: stamp }, { action: 'publish', state: 'VERIFIED', updatedAt: stamp }] };
    expect(verifiedEvidence(picture).verified).toBe(true);
    expect(verifiedEvidence(picture).action).toBe('publish');
    expect(resolvePresenceState({ phase: 'DORMANT', liveness: live(), now, picture })).toBe('VERIFIED');
    expect(presenceDetail({ phase: 'DORMANT', liveness: live(), now, picture })).toContain('publish verified');
  });

  it('does not let an old success become a permanent VERIFIED state', () => {
    const now = Date.now();
    const stale = new Date(now - 45 * 60 * 1000).toISOString();
    const picture = { capabilityActivity: [{ action: 'publish', state: 'VERIFIED', updatedAt: stale }] };
    expect(verifiedEvidence(picture, now).verified).toBe(false);
    expect(resolvePresenceState({ phase: 'DORMANT', liveness: live(), now, picture })).not.toBe('VERIFIED');
  });

  it('refuses to claim completion it cannot date', () => {
    const picture = { capabilityActivity: [{ action: 'publish', state: 'VERIFIED' }] };
    expect(verifiedEvidence(picture).verified).toBe(false);
    expect(resolvePresenceState({ phase: 'DORMANT', liveness: live(), picture })).not.toBe('VERIFIED');
  });

  it('refuses completion while any invocation is still active', () => {
    const picture = { capabilityActivity: [{ action: 'publish', state: 'VERIFIED' }, { action: 'notify', state: 'EXECUTING' }] };
    expect(verifiedEvidence(picture).verified).toBe(false);
    expect(resolvePresenceState({ phase: 'DORMANT', liveness: live(), picture })).toBe('STANDBY');
  });

  it('lets a later failure supersede an earlier success', () => {
    const picture = { capabilityActivity: [{ action: 'publish', state: 'VERIFIED' }, { action: 'publish', state: 'VERIFICATION_FAILED' }] };
    expect(verifiedEvidence(picture).verified).toBe(false);
    expect(resolvePresenceState({ phase: 'DORMANT', liveness: live(), picture })).toBe('STANDBY');
  });

  it('never invents completion from an empty or idle projection', () => {
    expect(verifiedEvidence(undefined).verified).toBe(false);
    expect(verifiedEvidence({ capabilityActivity: [] }).verified).toBe(false);
    expect(resolvePresenceState({ phase: 'DORMANT', liveness: live(), picture: {} })).toBe('STANDBY');
    expect(resolvePresenceState({ phase: 'AWARE', liveness: live() })).toBe('STANDBY');
  });
});

describe('degradation is never presented as healthy standby', () => {
  it('keeps the standby state but names the degradation', () => {
    const readout = presenceReadout({ phase: 'DEGRADED', liveness: live() });
    expect(readout.state).toBe('STANDBY');
    expect(readout.word).toBe('DEGRADED');
    expect(readout.degraded).toBe(true);
    expect(readout.tone).toBe('attention');
    expect(readout.detail).toContain('degraded');
  });

  it('reports degradation reported only on system health', () => {
    const readout = presenceReadout({ phase: 'DORMANT', liveness: live(), picture: { systemHealth: { overall: 'DEGRADED' } } });
    expect(readout.word).toBe('DEGRADED');
    expect(readout.detail).toContain('degraded');
  });

  it('leaves a genuinely healthy standby alone', () => {
    const readout = presenceReadout({ phase: 'DORMANT', liveness: live(), picture: { systemHealth: { overall: 'HEALTHY' } } });
    expect(readout.word).toBe('STANDBY');
    expect(readout.tone).toBe('idle');
  });
});

describe('readout agreement', () => {
  it('derives one state for the word, the sentence and the GPU', () => {
    for (const phase of ALL_PHASES) {
      const readout = presenceReadout({ phase, liveness: live() });
      expect(readout.state, phase).toBe(resolvePresenceState({ phase, liveness: live() }));
      expect(readout.word.length, phase).toBeGreaterThan(0);
      expect(readout.detail.length, phase).toBeGreaterThan(0);
      expect(presenceTone(readout.state), phase).toBeTruthy();
    }
  });
});

describe('vertical zones', () => {
  const viewports = [{ width: 390, height: 844 }, { width: 1280, height: 720 }, { width: 1856, height: 890 }, { width: 2560, height: 1440 }, { width: 1024, height: 600 }];
  it('never lets the response, word or input overlap at any tested viewport', () => {
    for (const viewport of viewports) {
      const composition = presenceComposition(viewport);
      const zones = presenceZones(viewport, composition);
      const label = `${viewport.width}x${viewport.height}`;
      expect(zones.horizon, label).toBeLessThan(zones.detailBottom);
      expect(zones.detailBottom, label).toBeLessThan(zones.answerTop);
      expect(zones.answerTop, label).toBeLessThan(zones.inputTop);
      expect(zones.inputTop, label).toBeLessThan(zones.inputBottom);
      expect(zones.inputBottom, label).toBeLessThanOrEqual(viewport.height);
      expect(zones.answerMaxHeight, label).toBeGreaterThanOrEqual(64);
      // Stacked layouts must fit between the readout and the input; docked ones
      // get their own column and are bounded by the viewport instead.
      if (zones.answerDocked) expect(zones.answerMaxHeight, label).toBeLessThanOrEqual(viewport.height * .5);
      else expect(zones.answerTop + zones.answerMaxHeight, label).toBeLessThanOrEqual(zones.inputTop);
    }
  });

  it('keeps the word below the orb at every tested viewport', () => {
    for (const viewport of viewports) {
      const composition = presenceComposition(viewport);
      const zones = presenceZones(viewport, composition);
      expect(zones.horizon, `${viewport.width}x${viewport.height}`).toBeGreaterThan(composition.layout.core.y + composition.coreRadius * .9);
    }
  });
});

describe('voice availability', () => {
  it('reports unavailable while disconnected, whatever the device says', () => {
    expect(presenceVoiceStatus({ liveness: stale(), micActive: false, available: true }).state).toBe('UNAVAILABLE');
    expect(presenceVoiceStatus({ liveness: stale(), micActive: true, available: true }).state).toBe('UNAVAILABLE');
  });

  it('reports unavailable when the RTC service is not ready', () => {
    expect(presenceVoiceStatus({ liveness: live(), micActive: false, available: false }).state).toBe('UNAVAILABLE');
  });

  it('reports a genuinely live microphone, and degradation when the device is lost', () => {
    expect(presenceVoiceStatus({ liveness: live(), micActive: true, available: true }).state).toBe('LIVE');
    expect(presenceVoiceStatus({ liveness: live(), micActive: false, available: true, picture: { voiceAudio: { deviceState: 'lost' } } }).state).toBe('DEGRADED');
    expect(presenceVoiceStatus({ liveness: live(), micActive: false, available: true, picture: { voiceAudio: { deviceState: 'ready' } } }).state).toBe('READY');
  });

  it('never describes capture as active before it is started', () => {
    const status = presenceVoiceStatus({ liveness: live(), micActive: false, available: true });
    expect(status.detail).toContain('not captured until you press it');
  });
});
