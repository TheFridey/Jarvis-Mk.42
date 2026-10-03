'use client';
import { FLOW_STAGES, type FlowStage, type FlowStatus } from './experience-phase-policy.ts';

const SHORT: Record<FlowStage, string> = { INPUT: 'IN', INTERPRET: 'PARSE', CONTEXT: 'CTX', ROUTE: 'ROUTE', MODEL: 'MODEL', RESULT: 'RESULT', POLICY: 'POLICY', APPROVAL: 'GATE', EXECUTE: 'EXEC', VERIFY: 'VERIFY', COMPLETE: 'DONE' };

/** Request lifecycle from projection signals; unobserved stages are drawn hollow, never as done. */
export function RequestFlow({ flow }: { flow: Record<FlowStage, FlowStatus> }) {
  const reached = FLOW_STAGES.some(stage => flow[stage] !== 'pending');
  if (!reached) return null;
  return <ol className="request-flow" aria-label="Request lifecycle">
    {FLOW_STAGES.map(stage => <li key={stage} className={`flow-${flow[stage]}`} aria-current={flow[stage] === 'active' ? 'step' : undefined} title={stage}>
      <i aria-hidden="true"/><span>{SHORT[stage]}</span><b className="sr-only">{flow[stage]}</b>
    </li>)}
  </ol>;
}
