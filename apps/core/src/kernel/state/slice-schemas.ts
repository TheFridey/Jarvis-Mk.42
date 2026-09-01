/**
 * Per-slice value schemas. A mutation whose value fails its slice schema is
 * rejected with `validation_failed` before anything is written.
 */
import { z } from 'zod';
import type { StateSliceKey } from '@jarvis/contracts';

const nullableString = z.string().nullable();

export const SLICE_SCHEMAS: Record<StateSliceKey, z.ZodTypeAny> = {
  active_principal: z.object({ principalId: nullableString }),
  mode: z.object({
    mode: z.enum(['DORMANT', 'AMBIENT', 'ENGAGED', 'FOCUSED', 'AUTONOMOUS', 'GUARDIAN', 'DEGRADED']),
  }),
  presence: z.object({
    state: z.enum(['UNKNOWN', 'ABSENT', 'PRESENT', 'ENGAGED', 'FOCUSED']),
    confidence: z.number().min(0).max(1),
  }),
  location: z.object({ spaceId: nullableString, ref: z.string().optional() }),
  active_session: z.object({ sessionId: nullableString }),
  active_context: z.object({ contextId: nullableString, version: z.number().nullable() }),
  active_objective: z.object({ objectiveId: nullableString }),
  active_workspace: z.object({ workspaceId: nullableString }),
  selected_object: z.object({ ref: nullableString }),
  cursor_target: z.object({ ref: nullableString }),
  gesture_target: z.object({ ref: nullableString }),
  gaze_target: z.object({ ref: nullableString }),
  running_tasks: z.object({ taskIds: z.array(z.string()) }),
  running_agents: z.object({ agentRunIds: z.array(z.string()) }),
  connected_nodes: z.object({ nodeIds: z.array(z.string()) }),
  active_alerts: z.object({ alertIds: z.array(z.string()) }),
  rtc_state: z.object({
    sessionId: nullableString,
    status: z.enum(['idle', 'connecting', 'live']),
  }),
  perception_state: z.object({
    streams: z.record(z.enum(['active', 'lost', 'unavailable', 'idle'])),
  }),
  degradation_state: z.object({
    level: z.enum(['nominal', 'degraded', 'critical']),
    criticalIssues: z.array(z.string()),
    overallHealth: z.enum(['STARTING', 'HEALTHY', 'DEGRADED', 'OFFLINE', 'RECOVERING']),
  }),
};
