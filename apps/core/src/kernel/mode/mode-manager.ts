/**
 * Mode Manager (ADR-0019). Owns the `mode` state slice. Every transition:
 *  - is checked by the pure transition policy (illegal -> rejected)
 *  - writes the `mode` slice through the StateManager (system actor)
 *  - emits `jarvis.kernel.mode.changed` (OPERATIONAL, or SECURITY for GUARDIAN)
 *
 * The Mode Manager holds NO authoritative state of its own - `mode` lives in
 * the one authoritative state store. It caches `since` for dwell/hysteresis.
 */
import {
  EventNames,
  type JarvisMode,
  type ModeRejectionCode,
  type ModeState,
  type ModeTransitionRequest,
  type ModeTransitionTrigger,
} from '@jarvis/contracts';
import type { Clock } from '../../runtime/clock.ts';
import type { IdGen } from '../../runtime/ids.ts';
import { Mutex } from '../../runtime/mutex.ts';
import type { EventManager } from '../event-fabric/event-manager.ts';
import type { StateManager } from '../state/state-manager.ts';
import { decideTransition } from './transition-policy.ts';

export interface ModeChangeOutcome {
  ok: boolean;
  from: JarvisMode;
  to: JarvisMode;
  code?: ModeRejectionCode;
  detail?: string;
  version?: number;
}

export interface ModeGuardInputs {
  presencePresent: boolean;
  activeObjectiveCount: number;
  criticalDepsHealthy: boolean;
}

export class ModeManager {
  private since: string;
  private lastTrigger: ModeTransitionTrigger = 'operator_request';
  private reason = 'cold start';
  private readonly gate = new Mutex();

  constructor(
    private readonly deps: {
      state: StateManager;
      events: EventManager;
      clock: Clock;
      ids: IdGen;
      minDwellMs: number;
      guardInputs: () => ModeGuardInputs;
    },
  ) {
    this.since = deps.clock.nowIso();
  }

  async current(): Promise<JarvisMode> {
    const slice = await this.deps.state.getSlice('mode');
    return (slice?.value as { mode: JarvisMode } | undefined)?.mode ?? 'DORMANT';
  }

  async state(): Promise<ModeState> {
    const slice = await this.deps.state.getSlice('mode');
    return {
      mode: (slice?.value as { mode: JarvisMode }).mode,
      since: this.since,
      version: slice?.version ?? 0,
      lastTrigger: this.lastTrigger,
      reason: this.reason,
    };
  }

  private dwellElapsed(): boolean {
    return this.deps.clock.epochMs() - Date.parse(this.since) >= this.deps.minDwellMs;
  }

  /**
   * Request a transition. `securityCleared` must be passed true by the caller
   * only when handling an explicit operator security-clear command.
   */
  requestTransition(
    to: JarvisMode,
    trigger: ModeTransitionTrigger,
    reason: string,
    opts: { securityCleared?: boolean; correlationId?: string } = {},
  ): Promise<ModeChangeOutcome> {
    return this.gate.run(() => this.doTransition(to, trigger, reason, opts));
  }

  private async doTransition(
    to: JarvisMode,
    trigger: ModeTransitionTrigger,
    reason: string,
    opts: { securityCleared?: boolean; correlationId?: string },
  ): Promise<ModeChangeOutcome> {
    const from = await this.current();
    const guards = this.deps.guardInputs();
    const req: ModeTransitionRequest = {
      to,
      trigger,
      reason,
      context: {
        presencePresent: guards.presencePresent,
        activeObjectiveCount: guards.activeObjectiveCount,
        criticalDepsHealthy: guards.criticalDepsHealthy,
        securityCleared: opts.securityCleared ?? false,
        minDwellElapsed: this.dwellElapsed(),
      },
    };

    const decision = decideTransition(from, req);
    if (!decision.allowed) {
      return { ok: false, from, to, code: decision.code, detail: decision.detail };
    }

    const correlationId = opts.correlationId ?? this.deps.ids.ulid();
    const isGuardian = to === 'GUARDIAN' || from === 'GUARDIAN';

    const result = await this.deps.state.mutate<{ mode: JarvisMode }>({
      key: 'mode',
      value: { mode: to },
      expectedVersion: -1, // system transitions are serialised by this manager
      correlationId,
      actor: { kind: 'system', id: 'mode-manager' },
      reason,
    });

    if (!result.ok) {
      return { ok: false, from, to, code: 'illegal_transition', detail: result.detail };
    }

    this.since = this.deps.clock.nowIso();
    this.lastTrigger = trigger;
    this.reason = reason;

    await this.deps.events.emit({
      type: EventNames.ModeChanged,
      retentionClass: isGuardian ? 'SECURITY' : 'OPERATIONAL',
      privacyClass: 'INTERNAL',
      subject: { kind: 'mode', id: 'system' },
      actor: { kind: 'system', id: 'mode-manager' },
      correlationId,
      causationId: result.eventId,
      principalId: 'system',
      payload: { from, to, trigger, reason, version: result.newVersion },
    });

    return { ok: true, from, to, version: result.newVersion };
  }
}
