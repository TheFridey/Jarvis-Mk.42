/**
 * In-process subscription registry. Clients subscribe to a set of slice keys
 * and receive StateUpdate pushes. Transport to remote clients (WebSocket) is a
 * later Experience-Plane concern; the registry is transport-agnostic.
 */
import type { StateSliceKey, StateUpdate } from '@jarvis/contracts';

export type StateListener = (update: StateUpdate) => void;

interface Entry {
  id: string;
  keys: Set<StateSliceKey> | 'all';
  listener: StateListener;
}

export class SubscriptionRegistry {
  private readonly entries = new Map<string, Entry>();
  private seq = 0;

  subscribe(keys: StateSliceKey[] | 'all', listener: StateListener): () => void {
    const id = `sub-${++this.seq}`;
    this.entries.set(id, {
      id,
      keys: keys === 'all' ? 'all' : new Set(keys),
      listener,
    });
    return () => {
      this.entries.delete(id);
    };
  }

  publish(update: StateUpdate): void {
    for (const entry of this.entries.values()) {
      if (entry.keys === 'all' || entry.keys.has(update.key)) {
        try {
          entry.listener(update);
        } catch {
          /* a broken subscriber must not affect the Kernel */
        }
      }
    }
  }

  get size(): number {
    return this.entries.size;
  }
}
