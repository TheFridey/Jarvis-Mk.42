export interface GuardianExecutor { invokeCapability(id: string, action: string, input: unknown): Promise<{ invocationId: string; outcome: string }>; }
export interface GuardianFinding { id?: string; nodeId?: string; summary: string; }
export async function runGuardianPlaybook(executor: GuardianExecutor, finding?: GuardianFinding) {
  const steps: Array<readonly [string, string, unknown]> = [
    ['capabilities.permission', 'tighten_all', {}],
    ['capabilities.agency_control', 'suspend_autonomous_external', {}],
    ['capabilities.audit', 'snapshot', {}],
  ];
  if (finding?.nodeId) steps.push(['capabilities.node', 'isolate', { nodeId: finding.nodeId }]);
  steps.push(['capabilities.notify', 'operator', { finding: finding?.summary ?? 'Guardian entered' }]);
  const outcomes = [];
  for (const [id, action, input] of steps) outcomes.push(await executor.invokeCapability(id, action, input));
  return { outcomes, policyLockdownActive: true };
}
