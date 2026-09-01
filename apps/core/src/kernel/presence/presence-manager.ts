/**
 * Presence Manager (KERNEL_CONSTITUTION.md #6). Consumes observation evidence,
 * derives a PresenceState deterministically, writes the `presence` state slice
 * (system actor) and emits `jarvis.kernel.presence.changed` on transitions.
 *
 * Holds a bounded in-memory window of recent evidence (the authoritative
 * `presence` value is in the state store; this window is reconstructible).
 */
import {
  EventNames,
  type PresenceEvidence,
  type PresenceSnapshot,
  type PresenceState,
} from '@jarvis/contracts';
import type { Clock } from '../../runtime/clock.ts';
import type { IdGen } from '../../runtime/ids.ts';
import { Mutex } from '../../runtime/mutex.ts';
import type { EventManager } from '../event-fabric/event-manager.ts';
import type { StateManager } from '../state/state-manager.ts';
import { derivePresence } from './presence-policy.ts';

const MAX_EVIDENCE = 24;
const EVIDENCE_TTL_MS = 5 * 60_000;

export class PresenceManager {
  private evidence: PresenceEvidence[] = [];
  private readonly gate = new Mutex();

  constructor(
    private readonly deps: {
      state: StateManager;
      events: EventManager;
      clock: Clock;
      ids: IdGen;
      principalId: () => string;
    },
  ) {}

  /** Feed one piece of observed evidence; re-derives and persists on change. */
  submitEvidence(ev: PresenceEvidence): Promise<void> {
    return this.gate.run(() => this.ingest(ev));
  }

  private async ingest(ev: PresenceEvidence): Promise<void> {
    const nowMs = this.deps.clock.epochMs();
    this.evidence.push(ev);
    this.evidence = this.evidence
      .filter((e) => nowMs - Date.parse(e.observedAt) <= EVIDENCE_TTL_MS)
      .slice(-MAX_EVIDENCE);

    const derived = derivePresence(this.evidence, nowMs);
    const slice = await this.deps.state.getSlice('presence');
    const prev = (slice?.value as { state: PresenceState; confidence: number } | undefined) ?? {
      state: 'UNKNOWN',
      confidence: 0,
    };

    if (prev.state === derived.state && Math.abs(prev.confidence - derived.confidence) < 0.15) {
      return; // no meaningful change
    }

    const correlationId = this.deps.ids.ulid();
    const result = await this.deps.state.mutate<{ state: PresenceState; confidence: number }>({
      key: 'presence',
      value: { state: derived.state, confidence: derived.confidence },
      expectedVersion: -1,
      correlationId,
      actor: { kind: 'system', id: 'presence-manager' },
      reason: `evidence:${ev.kind}`,
    });
    if (!result.ok) return;

    await this.deps.events.emit({
      type: EventNames.PresenceChanged,
      retentionClass: 'OPERATIONAL',
      privacyClass: 'SENSITIVE',
      subject: { kind: 'presence', id: this.deps.principalId() },
      actor: { kind: 'system', id: 'presence-manager' },
      correlationId,
      causationId: ev.sourceEventId,
      principalId: this.deps.principalId(),
      confidence: derived.confidence,
      payload: {
        from: prev.state,
        to: derived.state,
        confidence: derived.confidence,
        version: result.newVersion,
      },
    });
  }

  async snapshot(): Promise<PresenceSnapshot> {
    const slice = await this.deps.state.getSlice('presence');
    const v = (slice?.value as { state: PresenceState; confidence: number }) ?? {
      state: 'UNKNOWN',
      confidence: 0,
    };
    return {
      principalId: this.deps.principalId(),
      state: v.state,
      confidence: v.confidence,
      since: slice?.updatedAt ?? this.deps.clock.nowIso(),
      evidence: [...this.evidence].reverse(),
      version: slice?.version ?? 0,
    };
  }

  isPresent(state?: PresenceState): boolean {
    const s = state;
    return s === 'PRESENT' || s === 'ENGAGED' || s === 'FOCUSED';
  }
}
