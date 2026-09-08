/**
 * Session Manager (KERNEL_CONSTITUTION.md #2).
 *
 * A session is a bounded span of related activity - NOT necessarily a
 * conversation. Seven types, an explicit lifecycle state machine, participating
 * nodes, parent/child nesting, and handoff for future cross-device
 * continuation. Per-session transitions are serialised (KeyedMutex) and guarded
 * by optimistic concurrency (expectedVersion).
 */
import {
  EventNames,
  LEGAL_SESSION_TRANSITIONS,
  type OpenSessionRequest,
  type Session,
  type SessionHandoff,
  type SessionTransitionRequest,
} from '@jarvis/contracts';
import type { Clock } from '../../runtime/clock.ts';
import type { IdGen } from '../../runtime/ids.ts';
import { KeyedMutex } from '../../runtime/mutex.ts';
import type { EventManager, TxRunner } from '../event-fabric/event-manager.ts';
import { SessionStore } from './session-store.ts';

export type SessionResult =
  | { ok: true; session: Session }
  | { ok: false; code: SessionErrorCode; detail: string; currentVersion?: number };

export type SessionErrorCode =
  | 'not_found'
  | 'illegal_transition'
  | 'version_conflict'
  | 'handoff_required'
  | 'already_ended';

export class SessionManager {
  private readonly gate = new KeyedMutex();

  constructor(
    private readonly deps: {
      store: SessionStore;
      events: EventManager;
      tx: TxRunner;
      clock: Clock;
      ids: IdGen;
      credentials?: { revokeSession(sessionId: string, at: string): Promise<void> };
    },
  ) {}

  async open(req: OpenSessionRequest): Promise<Session> {
    const now = this.deps.clock.nowIso();
    const session: Session = {
      id: this.deps.ids.ulid(),
      type: req.type,
      principalId: req.principalId,
      nodes: [req.nodeId],
      state: 'starting',
      startedAt: now,
      lastActivityAt: now,
      openedByCorrelationId: req.correlationId,
      ...(req.parentSessionId ? { parentSessionId: req.parentSessionId } : {}),
      ...(req.contextRef ? { contextRef: req.contextRef } : {}),
      version: 0,
    };
    await this.deps.store.insert(session);
    await this.deps.events.emit({
      type: EventNames.SessionStarted,
      retentionClass: 'OPERATIONAL',
      privacyClass: 'INTERNAL',
      subject: { kind: 'session', id: session.id },
      actor: { kind: 'principal', id: req.principalId },
      correlationId: req.correlationId,
      causationId: req.correlationId,
      principalId: req.principalId,
      payload: {
        sessionId: session.id,
        type: session.type,
        principalId: session.principalId,
        nodeId: req.nodeId,
        ...(req.parentSessionId ? { parentSessionId: req.parentSessionId } : {}),
      },
    });
    return session;
  }

  get(id: string): Promise<Session | null> {
    return this.deps.store.get(id);
  }

  listActive(): Promise<Session[]> {
    return this.deps.store.listActive();
  }

  countActive() {
    return this.deps.store.countActive();
  }

  touch(id: string): Promise<void> {
    return this.deps.store.touch(id, this.deps.clock.nowIso());
  }

  transition(req: SessionTransitionRequest): Promise<SessionResult> {
    return this.gate.run(req.sessionId, () => this.doTransition(req));
  }

  private async doTransition(req: SessionTransitionRequest): Promise<SessionResult> {
    const session = await this.deps.store.get(req.sessionId);
    if (!session) return { ok: false, code: 'not_found', detail: `no session ${req.sessionId}` };
    if (session.state === 'ended') {
      return { ok: false, code: 'already_ended', detail: 'session already ended' };
    }

    const legal = LEGAL_SESSION_TRANSITIONS[session.state];
    if (!legal.includes(req.to)) {
      return {
        ok: false,
        code: 'illegal_transition',
        detail: `${session.state} -> ${req.to} not permitted`,
      };
    }
    if (req.to === 'handoff_pending' && !req.handoff) {
      return { ok: false, code: 'handoff_required', detail: 'handoff target required' };
    }

    const now = this.deps.clock.nowIso();
    const handoff: SessionHandoff | undefined = req.handoff
      ? { ...req.handoff, initiatedAt: now }
      : undefined;

    try {
      const result = await this.deps.tx.begin(async (tx) => {
        const currentVersion = await this.deps.store.lockVersion(tx, req.sessionId);
        if (currentVersion === null) {
          return { ok: false as const, code: 'not_found' as const, detail: 'row vanished' };
        }
        if (req.expectedVersion !== -1 && req.expectedVersion !== currentVersion) {
          return {
            ok: false as const,
            code: 'version_conflict' as const,
            detail: `expected v${req.expectedVersion}, current v${currentVersion}`,
            currentVersion,
          };
        }
        const newVersion = currentVersion + 1;
        const ended = req.to === 'ended';
        await this.deps.store.applyTransition(tx, {
          id: req.sessionId,
          state: req.to,
          newVersion,
          lastActivityAt: now,
          ...(ended ? { endedAt: now } : {}),
          handoff: handoff ?? null,
        });
        if (ended) await this.deps.credentials?.revokeSession(req.sessionId, now);
        await this.deps.events.emitInTx(tx, {
          type: ended ? EventNames.SessionEnded : EventNames.SessionTransitioned,
          retentionClass: 'OPERATIONAL',
          privacyClass: 'INTERNAL',
          subject: { kind: 'session', id: req.sessionId },
          actor: { kind: 'principal', id: session.principalId },
          correlationId: session.openedByCorrelationId,
          causationId: session.openedByCorrelationId,
          principalId: session.principalId,
          payload: ended
            ? { sessionId: req.sessionId, reason: req.reason }
            : {
                sessionId: req.sessionId,
                from: session.state,
                to: req.to,
                reason: req.reason,
                version: newVersion,
              },
        });
        return { ok: true as const, newVersion };
      });

      if (!result.ok) return result;
      const updated = await this.deps.store.get(req.sessionId);
      return { ok: true, session: updated! };
    } catch (err) {
      return {
        ok: false,
        code: 'illegal_transition',
        detail: `transition failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /** Attach/detach a participating node (cross-device continuation support). */
  async setNodes(sessionId: string, nodes: string[]): Promise<void> {
    await this.gate.run(sessionId, async () => {
      await this.deps.tx.begin(async (tx) => {
        const v = await this.deps.store.lockVersion(tx, sessionId);
        if (v === null) return;
        const session = await this.deps.store.get(sessionId);
        if (!session || session.state === 'ended') return;
        await this.deps.store.applyTransition(tx, {
          id: sessionId,
          state: session.state,
          newVersion: v + 1,
          lastActivityAt: this.deps.clock.nowIso(),
          nodes,
        });
      });
    });
  }
}
