import type { AgentId } from '@jarvis/contracts';
import type { DesktopCognitionCommand } from '@jarvis/scene';
type DesktopTask = NonNullable<DesktopCognitionCommand['task']>;
/** Intent selection only. Grants, privacy and execution still belong to Kernel policy. */
export function desktopRoute(input: string, explicit: { agentId?: AgentId; task?: DesktopTask } = {}): { agentId: AgentId; task: DesktopTask } {
  if (explicit.agentId || explicit.task) return { agentId: explicit.agentId ?? (explicit.task === 'code' ? 'agents.forge' : 'agents.oracle'), task: explicit.task ?? 'reason' };
  if (/\b(repository|codebase|pull request|code repair|unit tests?|typescript|refactor)\b/i.test(input)) return { agentId: 'agents.forge', task: 'code' };
  if (/^\s*(?:(?:jarvis[, ]+)?(?:what is|what's|calculate)\s+)?-?\d+(?:\.\d+)?\s*[+*/−-]\s*-?\d+(?:\.\d+)?\s*[?.]?\s*$/i.test(input)) return { agentId: 'agents.oracle', task: 'extract' };
  return { agentId: 'agents.oracle', task: 'reason' };
}
