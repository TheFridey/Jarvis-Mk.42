/**
 * Scheduler (KERNEL_CONSTITUTION.md #13). INTERNAL routines only in MK.43:
 * health checks, retention sweeps, snapshot cadence, mode-dwell re-evaluation,
 * objective re-evaluation (placeholder). Decides WHEN, never WHAT.
 *
 *  - interval / cron / once schedules
 *  - `singleton`: skip a run if the previous one is still executing
 *  - bounded retry with backoff; exhausted -> job `dead`
 *  - `pausedWhenDegraded`: routine is skipped while mode is DEGRADED/GUARDIAN
 *  - every run emits `jarvis.kernel.scheduler.tick` (DIAGNOSTIC)
 *  - graceful stop: in-flight routines get an AbortSignal
 */
import {
  EventNames,
  type JobStatus,
  type RoutineContext,
  type RoutineHandler,
  type ScheduleDefinition,
} from '@jarvis/contracts';
import type { Clock } from '../../runtime/clock.ts';
import type { IdGen } from '../../runtime/ids.ts';
import type { EventManager } from '../event-fabric/event-manager.ts';
import { cronMatches } from './cron.ts';

interface Registered {
  def: ScheduleDefinition;
  handler: RoutineHandler;
  running: boolean;
  lastRunMs: number;
  nextIntervalDueMs: number;
  lastCronMinute: number;
}

export type ModePauseCheck = () => boolean; // true => paused (DEGRADED/GUARDIAN)

export class Scheduler {
  private readonly routines = new Map<string, Registered>();
  private tickTimer: ReturnType<typeof setInterval> | undefined;
  private readonly abort = new AbortController();
  private stopped = true;
  private history: Array<{ scheduleId: string; jobRunId: string; status: JobStatus; at: number }> = [];

  constructor(
    private readonly deps: {
      events: EventManager;
      clock: Clock;
      ids: IdGen;
      isPaused: ModePauseCheck;
      tickMs?: number;
    },
  ) {}

  register(def: ScheduleDefinition, handler: RoutineHandler): void {
    this.routines.set(def.id, {
      def,
      handler,
      running: false,
      lastRunMs: 0,
      nextIntervalDueMs:
        def.kind === 'interval'
          ? this.deps.clock.epochMs() + Number(def.spec)
          : 0,
      lastCronMinute: -1,
    });
  }

  start(): void {
    this.stopped = false;
    const tickMs = this.deps.tickMs ?? 1000;
    this.tickTimer = setInterval(() => void this.tick(), tickMs);
  }

  /** Run one evaluation pass now (also used by tests). */
  async tick(): Promise<void> {
    if (this.stopped) return;
    const now = this.deps.clock.now();
    const nowMs = now.getTime();
    for (const r of this.routines.values()) {
      if (!r.def.enabled) continue;
      if (this.shouldRun(r, now, nowMs)) {
        void this.runRoutine(r, nowMs);
      }
    }
  }

  private shouldRun(r: Registered, now: Date, nowMs: number): boolean {
    if (r.def.singleton && r.running) return false;
    switch (r.def.kind) {
      case 'interval':
        return nowMs >= r.nextIntervalDueMs;
      case 'cron': {
        const minuteKey = Math.floor(nowMs / 60_000);
        if (minuteKey === r.lastCronMinute) return false;
        return cronMatches(String(r.def.spec), now);
      }
      case 'once':
        return r.lastRunMs === 0 && (!r.def.runAt || nowMs >= Date.parse(r.def.runAt));
    }
  }

  private async runRoutine(r: Registered, nowMs: number): Promise<void> {
    if (r.def.pausedWhenDegraded && this.deps.isPaused()) {
      await this.emitTick(r.def.id, this.deps.ids.ulid(), 'skipped', 0);
      this.mark(r, nowMs);
      return;
    }
    r.running = true;
    this.mark(r, nowMs);
    const jobRunId = this.deps.ids.ulid();

    let attempt = 0;
    let status: JobStatus = 'failed';
    const started = this.deps.clock.epochMs();
    while (attempt <= r.def.maxRetries) {
      attempt++;
      const ctx: RoutineContext = {
        scheduleId: r.def.id,
        jobRunId,
        attempt,
        signal: this.abort.signal,
      };
      try {
        await r.handler(ctx);
        status = 'succeeded';
        break;
      } catch {
        status = attempt <= r.def.maxRetries ? 'retrying' : 'dead';
        if (attempt <= r.def.maxRetries) {
          await sleep(r.def.retryBackoffMs * attempt);
        }
      }
    }

    r.running = false;
    const durationMs = this.deps.clock.epochMs() - started;
    await this.emitTick(r.def.id, jobRunId, status, durationMs);
  }

  private mark(r: Registered, nowMs: number): void {
    r.lastRunMs = nowMs;
    if (r.def.kind === 'interval') r.nextIntervalDueMs = nowMs + Number(r.def.spec);
    if (r.def.kind === 'cron') r.lastCronMinute = Math.floor(nowMs / 60_000);
  }

  private async emitTick(
    scheduleId: string,
    jobRunId: string,
    status: JobStatus,
    durationMs: number,
  ): Promise<void> {
    this.history.push({ scheduleId, jobRunId, status, at: this.deps.clock.epochMs() });
    if (this.history.length > 200) this.history.shift();
    await this.deps.events
      .emit({
        type: EventNames.SchedulerTick,
        retentionClass: 'DIAGNOSTIC',
        privacyClass: 'INTERNAL',
        subject: { kind: 'schedule', id: scheduleId },
        actor: { kind: 'system', id: 'scheduler' },
        correlationId: jobRunId,
        causationId: 'none',
        principalId: 'system',
        payload: { scheduleId, jobRunId, status, attempt: 1, durationMs },
      })
      .catch(() => undefined);
  }

  recentRuns(scheduleId?: string) {
    return scheduleId ? this.history.filter((h) => h.scheduleId === scheduleId) : [...this.history];
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.abort.abort();
    // let in-flight routines observe the abort
    const deadline = this.deps.clock.epochMs() + 5000;
    while ([...this.routines.values()].some((r) => r.running) && this.deps.clock.epochMs() < deadline) {
      await sleep(50);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
