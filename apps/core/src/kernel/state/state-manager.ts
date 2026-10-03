/**
 * Authoritative State Manager (L5, L6, ADR-0017, KERNEL_CONSTITUTION.md #4).
 *
 * ONE authoritative logical state, held as independently-versioned slices.
 * Clients REQUEST mutations; they never become the authority. Every accepted
 * mutation:
 *   - passes the slice value schema
 *   - passes optimistic-concurrency (expectedVersion vs current, under row lock)
 *   - emits `state.mutated` and writes the new value in ONE transaction
 *   - bumps the slice version and the monotonic global stateVersion
 *   - notifies subscribers
 *
 * Invariant enforced by the row lock in `lockSliceVersion`: two mutations to
 * the same slice can never both be accepted against the same base version.
 */
import {
  EventNames,
  type EventActor,
  type MutationRejectionCode,
  type MutationRequest,
  type MutationResult,
  type StateSlice,
  type StateSliceKey,
  type StateSnapshot,
  type SystemStateView,
  type Event,
} from '@jarvis/contracts';
import { createHash } from 'node:crypto';
import type { Sql } from '@jarvis/persistence';
import type { EventManager, TxRunner } from '../event-fabric/event-manager.ts';
import { CLIENT_WRITABLE_SLICES, SYSTEM_ONLY_SLICES } from './defaults.ts';
import { SLICE_SCHEMAS } from './slice-schemas.ts';
import { StateStore } from './state-store.ts';
import { SubscriptionRegistry, type StateListener } from './subscriptions.ts';
import { canonicalJson } from '../../runtime/canonical-json.ts';

function hashValue(v: unknown): string {
  return createHash('sha256').update(canonicalJson(v)).digest('hex').slice(0, 16);
}

export interface StateManagerDeps {
  sql: Sql;
  tx: TxRunner;
  store: StateStore;
  events: EventManager;
}

export class StateManager {
  private readonly subs = new SubscriptionRegistry();
  private shuttingDown = false;
  private lastMutationAt: string | null = null;

  constructor(private readonly deps: StateManagerDeps) {}

  async init(): Promise<void> {
    await this.deps.store.ensureInitialised();
  }

  beginShutdown(): void {
    this.shuttingDown = true;
  }

  get subscriberCount(): number {
    return this.subs.size;
  }

  get lastMutationTime(): string | null {
    return this.lastMutationAt;
  }

  subscribe(keys: StateSliceKey[] | 'all', listener: StateListener): () => void {
    return this.subs.subscribe(keys, listener);
  }

  view(): Promise<SystemStateView> {
    return this.deps.store.view();
  }

  getSlice(key: StateSliceKey): Promise<StateSlice | null> {
    return this.deps.store.getSlice(key);
  }

  private reject(
    key: StateSliceKey,
    code: MutationRejectionCode,
    detail: string,
    currentVersion?: number,
  ): MutationResult {
    return currentVersion === undefined
      ? { ok: false, key, code, detail }
      : { ok: false, key, code, detail, currentVersion };
  }

  async mutate<T = unknown>(req: MutationRequest<T>): Promise<MutationResult> {
    if (this.shuttingDown) {
      return this.reject(req.key, 'shutting_down', 'Kernel is shutting down');
    }

    const schema = SLICE_SCHEMAS[req.key];
    if (!schema) return this.reject(req.key, 'unknown_slice', `no such slice: ${req.key}`);

    const isSystemActor = req.actor.kind === 'system';
    if (!isSystemActor) {
      if (SYSTEM_ONLY_SLICES.has(req.key) || !CLIENT_WRITABLE_SLICES.has(req.key)) {
        return this.reject(req.key, 'forbidden_slice', `slice ${req.key} is not client-writable`);
      }
    }

    const parsed = schema.safeParse(req.value);
    if (!parsed.success) {
      return this.reject(
        req.key,
        'validation_failed',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      );
    }

    let committedEvent:Event|undefined;
    try {
      const result = await this.deps.tx.begin(async (tx) => {
        const currentVersion = await this.deps.store.lockSliceVersion(tx, req.key);
        if (currentVersion === null) {
          return this.reject(req.key, 'unknown_slice', `slice row missing: ${req.key}`);
        }
        if (req.expectedVersion !== -1 && req.expectedVersion !== currentVersion) {
          return this.reject(
            req.key,
            'version_conflict',
            `expected v${req.expectedVersion}, current is v${currentVersion}`,
            currentVersion,
          );
        }
        const newVersion = currentVersion + 1;
        const stateVersion = await this.deps.store.bumpStateVersionInTx(tx);
        const event = await this.deps.events.emitInTx(tx, {
          type: EventNames.StateMutated,
          retentionClass: 'OPERATIONAL',
          privacyClass: 'INTERNAL',
          subject: { kind: 'state_slice', id: req.key },
          actor: req.actor,
          correlationId: req.correlationId,
          causationId: req.correlationId,
          principalId: this.principalOf(req.actor),
          payload: {
            key: req.key,
            value: parsed.data,
            newVersion,
            stateVersion: Number(stateVersion),
            reason: req.reason,
            valueHash: hashValue(parsed.data),
            actorKind: req.actor.kind,
          },
        },false);
        committedEvent=event;
        await this.deps.store.writeSliceInTx(tx, {
          key: req.key,
          value: parsed.data,
          newVersion,
          eventId: event.id,
          correlationId: req.correlationId,
        });
        return {
          ok: true as const,
          key: req.key,
          newVersion,
          stateVersion: Number(stateVersion),
          eventId: event.id,
        };
      });

      if (result.ok) {
        if(committedEvent)this.deps.events.notifyCommitted(committedEvent);
        this.lastMutationAt = new Date().toISOString();
        const slice = await this.deps.store.getSlice(req.key);
        if (slice) {
          this.subs.publish({
            key: req.key,
            slice,
            stateVersion: result.stateVersion,
            eventId: result.eventId,
          });
        }
      }
      return result;
    } catch (err) {
      return this.reject(
        req.key,
        'validation_failed',
        `mutation failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private principalOf(actor: EventActor): string {
    if (actor.kind === 'principal') return actor.id;
    if (actor.kind === 'agent' && actor.onBehalfOf) return actor.onBehalfOf;
    return 'system';
  }

  // --- snapshots & recovery ---

  takeSnapshot(checkpointEventId: string | null): Promise<StateSnapshot> {
    return this.deps.store.takeSnapshot(checkpointEventId);
  }

  latestSnapshot(): Promise<StateSnapshot | null> {
    return this.deps.store.latestSnapshot();
  }

  checkpointEventId(): Promise<string | null> {
    return this.deps.store.checkpointEventId();
  }
}
