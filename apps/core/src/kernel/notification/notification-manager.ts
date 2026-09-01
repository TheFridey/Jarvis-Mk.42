/**
 * Notification Manager (KERNEL_CONSTITUTION.md #14). The ONLY path for a
 * user-directed alert. Applies the interruption gate, dedupe, and batching;
 * emits `jarvis.kernel.notification.raised` with the disposition; tracks the
 * active-alerts state slice.
 *
 * Delivery transport (to an Experience surface) is a later concern; this
 * component decides disposition and records it. "delivered" notifications are
 * handed to any registered sink.
 */
import {
  EventNames,
  type JarvisMode,
  type NotificationDisposition,
  type NotificationRecord,
  type NotificationRequest,
  type PresenceState,
} from '@jarvis/contracts';
import type { Clock } from '../../runtime/clock.ts';
import type { IdGen } from '../../runtime/ids.ts';
import { Mutex } from '../../runtime/mutex.ts';
import type { EventManager } from '../event-fabric/event-manager.ts';
import type { StateManager } from '../state/state-manager.ts';
import {
  DEFAULT_INTERRUPTION_POLICY,
  decideDisposition,
  type GateContext,
} from './interruption-policy.ts';

export type NotificationSink = (record: NotificationRecord) => void;

export class NotificationManager {
  private readonly recentDedupe = new Map<string, number>();
  private readonly gate = new Mutex();
  private readonly batch: NotificationRecord[] = [];
  private sinks: NotificationSink[] = [];
  private surfaceCount = 0;

  constructor(
    private readonly deps: {
      state: StateManager;
      events: EventManager;
      clock: Clock;
      ids: IdGen;
      currentMode: () => Promise<JarvisMode>;
      currentPresence: () => Promise<PresenceState>;
    },
  ) {}

  registerSink(sink: NotificationSink): void {
    this.sinks.push(sink);
  }

  /** Experience surfaces call these as they connect/disconnect. */
  setSurfaceCount(n: number): void {
    this.surfaceCount = Math.max(0, n);
  }

  submit(req: NotificationRequest): Promise<NotificationRecord> {
    return this.gate.run(() => this.process(req));
  }

  private async process(req: NotificationRequest): Promise<NotificationRecord> {
    const nowMs = this.deps.clock.epochMs();
    this.pruneDedupe(nowMs);

    const lastSeen = this.recentDedupe.get(req.dedupeKey);
    const isDuplicate =
      lastSeen !== undefined && nowMs - lastSeen < DEFAULT_INTERRUPTION_POLICY.dedupeWindowMs;
    if (!isDuplicate) this.recentDedupe.set(req.dedupeKey, nowMs);

    const [mode, presence] = await Promise.all([
      this.deps.currentMode(),
      this.deps.currentPresence(),
    ]);
    const ctx: GateContext = {
      mode,
      userFocused: presence === 'FOCUSED',
      isDuplicate,
      noSurface: this.surfaceCount === 0,
    };

    const { disposition, rationale } = decideDisposition(req, ctx);
    const record: NotificationRecord = {
      id: this.deps.ids.ulid(),
      request: req,
      disposition,
      decidedAt: this.deps.clock.nowIso(),
      rationale,
    };

    if (disposition === 'batched') this.batch.push(record);

    await this.deps.events
      .emit({
        type: EventNames.NotificationRaised,
        retentionClass: 'OPERATIONAL',
        privacyClass: 'INTERNAL',
        subject: { kind: 'notification', id: record.id },
        actor: { kind: 'system', id: req.source },
        correlationId: req.correlationId,
        causationId: req.correlationId,
        principalId: req.principalId,
        payload: {
          notificationId: record.id,
          source: req.source,
          severity: req.severity,
          urgency: req.urgency,
          disposition,
          rationale,
        },
      })
      .catch(() => undefined);

    if (disposition === 'delivered') {
      await this.addAlert(record.id, req.correlationId);
      for (const s of this.sinks) {
        try {
          s(record);
        } catch {
          /* sink failure must not affect the Kernel */
        }
      }
    }

    return record;
  }

  /** Flush batched notifications as a single digest record (called by a routine). */
  async flushBatch(): Promise<NotificationRecord | null> {
    return this.gate.run(async () => {
      if (this.batch.length === 0) return null;
      const items = this.batch.splice(0);
      const digest: NotificationRecord = {
        id: this.deps.ids.ulid(),
        request: {
          source: 'notification-manager',
          principalId: items[0]!.request.principalId,
          severity: 'notice',
          urgency: 'normal',
          title: `${items.length} batched notification(s)`,
          body: items.map((i) => `- ${i.request.title}`).join('\n'),
          dedupeKey: `digest-${this.deps.clock.epochMs()}`,
          correlationId: this.deps.ids.ulid(),
        },
        disposition: 'delivered',
        decidedAt: this.deps.clock.nowIso(),
        rationale: 'batched digest flush',
      };
      for (const s of this.sinks) {
        try {
          s(digest);
        } catch {
          /* ignore */
        }
      }
      return digest;
    });
  }

  get batchedCount(): number {
    return this.batch.length;
  }

  private pruneDedupe(nowMs: number): void {
    const cutoff = nowMs - DEFAULT_INTERRUPTION_POLICY.dedupeWindowMs;
    for (const [k, t] of this.recentDedupe) if (t < cutoff) this.recentDedupe.delete(k);
  }

  private async addAlert(id: string, correlationId: string): Promise<void> {
    const slice = await this.deps.state.getSlice('active_alerts');
    const current = ((slice?.value as { alertIds: string[] } | undefined)?.alertIds ?? []).slice(-49);
    await this.deps.state
      .mutate({
        key: 'active_alerts',
        value: { alertIds: [...current, id] },
        expectedVersion: -1,
        correlationId,
        actor: { kind: 'system', id: 'notification-manager' },
        reason: 'notification delivered',
      })
      .catch(() => undefined);
  }
}

export type { NotificationDisposition };
