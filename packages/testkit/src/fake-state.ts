/**
 * In-memory stand-in for the StateManager, for unit-testing components that
 * depend on it (Mode/Presence/Health/Notification managers) without Postgres.
 * Mirrors the real optimistic-concurrency + versioning semantics.
 */
import type {
  MutationRequest,
  MutationResult,
  StateSlice,
  StateSliceKey,
  StateUpdate,
  SystemStateView,
} from '@jarvis/contracts';

const INITIAL: Record<string, unknown> = {
  active_principal: { principalId: null },
  mode: { mode: 'DORMANT' },
  presence: { state: 'UNKNOWN', confidence: 0 },
  location: { spaceId: null },
  active_session: { sessionId: null },
  active_context: { contextId: null, version: null },
  active_objective: { objectiveId: null },
  active_workspace: { workspaceId: null },
  selected_object: { ref: null },
  cursor_target: { ref: null },
  gesture_target: { ref: null },
  gaze_target: { ref: null },
  running_tasks: { taskIds: [] },
  running_agents: { agentRunIds: [] },
  connected_nodes: { nodeIds: [] },
  active_alerts: { alertIds: [] },
  rtc_state: { sessionId: null, status: 'idle' },
  perception_state: { streams: {} },
  degradation_state: { level: 'nominal', criticalIssues: [], overallHealth: 'STARTING' },
};

export class FakeStateManager {
  private slices = new Map<string, StateSlice>();
  private stateVersion = 0;
  private evSeq = 0;
  private listeners: ((u: StateUpdate) => void)[] = [];
  lastMutationTime: string | null = null;

  constructor() {
    for (const [key, value] of Object.entries(INITIAL)) {
      this.slices.set(key, {
        key: key as StateSliceKey,
        value,
        version: 0,
        updatedAt: new Date(0).toISOString(),
        lastEventId: null,
        updatedByCorrelationId: null,
      });
    }
  }

  async init(): Promise<void> {}
  beginShutdown(): void {}

  async getSlice(key: StateSliceKey): Promise<StateSlice | null> {
    return this.slices.get(key) ?? null;
  }

  async view(): Promise<SystemStateView> {
    const slices = {} as SystemStateView['slices'];
    for (const [k, v] of this.slices) slices[k as StateSliceKey] = v;
    return { stateVersion: this.stateVersion, generatedAt: new Date().toISOString(), slices };
  }

  subscribe(_keys: StateSliceKey[] | 'all', listener: (u: StateUpdate) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  async mutate<T = unknown>(req: MutationRequest<T>): Promise<MutationResult> {
    const slice = this.slices.get(req.key);
    if (!slice) return { ok: false, key: req.key, code: 'unknown_slice', detail: 'no slice' };
    if (req.expectedVersion !== -1 && req.expectedVersion !== slice.version) {
      return {
        ok: false,
        key: req.key,
        code: 'version_conflict',
        detail: `expected ${req.expectedVersion} got ${slice.version}`,
        currentVersion: slice.version,
      };
    }
    const newVersion = slice.version + 1;
    this.stateVersion += 1;
    const eventId = `evt-${++this.evSeq}`.padEnd(26, '0');
    const updated: StateSlice = {
      key: req.key,
      value: req.value,
      version: newVersion,
      updatedAt: new Date().toISOString(),
      lastEventId: eventId,
      updatedByCorrelationId: req.correlationId,
    };
    this.slices.set(req.key, updated);
    this.lastMutationTime = updated.updatedAt;
    for (const l of this.listeners) l({ key: req.key, slice: updated, stateVersion: this.stateVersion, eventId });
    return { ok: true, key: req.key, newVersion, stateVersion: this.stateVersion, eventId };
  }

  async checkpointEventId(): Promise<string | null> {
    return null;
  }
}
