/**
 * Initial values for every authoritative state slice. Written once at cold
 * start if a slice row does not yet exist.
 */
import type { KnownSliceValues, StateSliceKey } from '@jarvis/contracts';

export const INITIAL_SLICE_VALUES: KnownSliceValues = {
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

export const ALL_SLICE_KEYS = Object.keys(INITIAL_SLICE_VALUES) as StateSliceKey[];

/**
 * Slices a client may mutate directly via MutationRequest. The rest are
 * system-owned: they change only through their owning subsystem (e.g.
 * degradation_state <- Health Manager, mode <- Mode Manager, presence <-
 * Presence Manager). Those subsystems still go through StateManager.mutate but
 * with `actor.kind = "system"`, which bypasses this allow-list.
 */
export const CLIENT_WRITABLE_SLICES: ReadonlySet<StateSliceKey> = new Set<StateSliceKey>([
  'active_workspace',
  'selected_object',
  'cursor_target',
  'gesture_target',
  'active_context',
]);

export const SYSTEM_ONLY_SLICES: ReadonlySet<StateSliceKey> = new Set<StateSliceKey>([
  'mode',
  'presence',
  'degradation_state',
  'perception_state',
  'connected_nodes',
  'active_principal',
  'active_session',
  'running_agents',
]);
