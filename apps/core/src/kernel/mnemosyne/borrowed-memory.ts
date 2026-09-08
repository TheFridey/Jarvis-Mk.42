/**
 * Working / session / spatial memory are BORROWED classes (MNEMOSYNE_MODEL.md
 * §2): MNEMOSYNE does not own or persist them. These readers expose the owners'
 * data for consolidation to scan, and nothing here writes.
 *
 *   working memory -> Kernel Ephemeral store (Redis) + the `active_context`
 *                     state slice; MNEMOSYNE only reads it.
 *   session memory -> a projection over `session.*` events / the Session Manager.
 *   spatial memory -> the Scene service; only an episode's `sceneRef` is stored
 *                     here, so there is no reader — it is a pointer.
 */
import type { StateManager } from '../state/state-manager.ts';
import type { SessionStore } from '../session/session-store.ts';
import type { EphemeralStore } from '../lifecycle/ephemeral.ts';

export class WorkingMemoryReader {
  constructor(private readonly deps: { state: StateManager; ephemeral: EphemeralStore }) {}

  /** The current immediate-cognition context, borrowed from the state slice the
   *  Kernel already owns. Never persisted into MNEMOSYNE. */
  async snapshot(): Promise<{ activeContext: unknown; ephemeralConnected: boolean }> {
    const slice = await this.deps.state.getSlice('active_context').catch(() => undefined);
    return { activeContext: slice?.value ?? null, ephemeralConnected: this.deps.ephemeral.connected };
  }
}

export class SessionMemoryReader {
  constructor(private readonly deps: { sessions: SessionStore }) {}

  /** Active sessions as lightweight session-memory context. A projection over
   *  the Session Manager's data — no new store. */
  async active(): Promise<Array<{ id: string; type: string; startedAt: string; lastActivityAt: string }>> {
    const rows = await this.deps.sessions.listActive().catch(() => []);
    return rows.map((s) => ({ id: s.id, type: s.type, startedAt: s.startedAt, lastActivityAt: s.lastActivityAt }));
  }
}
