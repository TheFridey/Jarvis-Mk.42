'use client';
import { useState } from 'react';
import { AGENT_ORCHESTRATION_GROUPS, type OperatingAgentJob } from '@jarvis/scene';
import type { AgentNode } from './agent-field-policy.ts';
import type { DataLiveness } from './experience-phase-policy.ts';
import { presentationBus } from './presentation-bus.ts';
import { agentPoint, type SpatialLayout } from './spatial-layout-policy.ts';

/** Agent labels pinned to their GPU orbit positions. Only agents with observed jobs appear. */
export function AgentField({ nodes, layout, liveness, onInspect }: { nodes: AgentNode[]; layout: SpatialLayout; liveness: DataLiveness; onInspect: () => void }) {
  if (!nodes.length) return null;
  return <section className={`agent-field${liveness.current ? '' : ' not-current'}`} aria-label="Agent orchestration">
    {nodes.map((node, i) => {
      const at = agentPoint(layout, i, node.state);
      if (!at) return null;
      const state = liveness.current ? node.state : 'LAST OBSERVED';
      const fallback = { dx: at.x - layout.core.x, dy: at.y - layout.core.y };
      return <button key={node.agentId} ref={element => element ? presentationBus.registerOffset(`agent:${node.agentId}`, element, fallback) : undefined} type="button" className={`agent-node state-${node.state.toLowerCase()}${node.animated ? ' animated' : ''}`} style={{ left: layout.core.x, top: layout.core.y }} onClick={onInspect}
        aria-label={`${node.name}, ${state}${node.groups.length ? `, ${node.groups.join(' and ')}` : ''}. Open agent inspector.`}>
        <span className="agent-label"><strong>{node.name}</strong><small>{state}{node.stage && node.stage !== node.state ? ` · ${node.stage}` : ''}{node.jobCount > 1 ? ` · ${node.jobCount} JOBS` : ''}</small></span>
      </button>;
    })}
  </section>;
}

/** Developer inspector: the full job projection, including cancellation. */
export function AgentInspector({ jobs, live, generatedAt, onCancel }: { jobs: OperatingAgentJob[]; live: boolean; generatedAt?: string; onCancel?: (jobId: string) => Promise<void> }) {
  const [pending, setPending] = useState<string>();
  const [message, setMessage] = useState('');
  const cancel = async (jobId: string) => {
    if (!live || !onCancel) return;
    setPending(jobId); setMessage('');
    try { await onCancel(jobId); setMessage('Cancellation processed by Kernel. Awaiting authoritative projection.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setPending(undefined); }
  };
  return <div className="agent-inspector">
    <p className="signal">JARVIS → orchestration group → specialist → model → proposal. Groups confer no authority. Elapsed time is measured at the last projection.</p>
    {!live && <p role="status" className="signal stale">Disconnected: these records are not live.</p>}
    {message && <p role="status">{message}</p>}
    {jobs.length === 0 && <p className="signal">No observed agent jobs. The specialist roster is not simulated activity.</p>}
    <ul>{jobs.map(job => {
      const groups = Object.entries(AGENT_ORCHESTRATION_GROUPS).filter(([, agents]) => (agents as readonly string[]).includes(job.agentId)).map(([group]) => group);
      const end = job.finishedAt ?? generatedAt;
      const elapsed = job.startedAt && end ? Math.max(0, Date.parse(end) - Date.parse(job.startedAt)) : undefined;
      return <li key={job.jobId} className={`job-${job.state.toLowerCase()}`}>
        <header><strong>{job.agentId.replace('agents.', '').toUpperCase()}</strong><span>{live ? job.state : 'LAST OBSERVED'}{job.activityConfirmed === false ? ' · UNCONFIRMED' : ''}</span></header>
        <p className="path">JARVIS → {groups.join(' / ') || 'SPECIALIST'} → {job.agentId.replace('agents.', '')} → {job.selectedModelId ?? 'MODEL NOT OBSERVED'}</p>
        <p>STAGE {job.activityStage ?? job.state} · TASK {job.taskClass.toUpperCase()}</p>
        {['RUNNING', 'WAITING'].includes(job.state) && job.activityConfirmed === false && <p className="signal">Worker lease unconfirmed. No live activity is implied.</p>}
        <dl>
          <dt>Job / attempt</dt><dd>{job.jobId} / {job.attempt}</dd>
          <dt>Elapsed / wall budget</dt><dd>{elapsed === undefined ? 'NOT STARTED' : `${(elapsed / 1000).toFixed(1)}s`} / {job.budget.wallMs / 1000}s</dd>
          <dt>Context / cost ceiling</dt><dd>{job.budget.contextUnits} units / {job.budget.costLimit} abstract cost units</dd>
          <dt>Objective</dt><dd>{job.objectiveId ?? 'NONE'}</dd>
          <dt>Parent dependency</dt><dd>{job.parentJobId ?? 'ROOT'}</dd>
          <dt>Capability proposals</dt><dd>{job.proposedCapabilities.join(', ') || 'NONE'}</dd>
        </dl>
        <p className="signal">{job.proposalCount} validated proposals · {job.evidenceCount ?? job.evidenceRefs.length} evidence refs{job.evidenceRefsTruncated ? ' (reference sample bounded)' : ''}. COMPLETE means cognitive output, not verified effects.</p>
        {job.capabilityActivity?.length ? <ul className="job-effects">{job.capabilityActivity.map(effect => <li key={effect.invocationId}>→ {effect.capabilityId} · {effect.state} · {effect.invocationId}</li>)}</ul> : null}
        {onCancel && ['QUEUED', 'LEASED', 'RUNNING', 'WAITING', 'BLOCKED'].includes(job.state) && <button disabled={!live || Boolean(pending)} onClick={() => void cancel(job.jobId)}>{pending === job.jobId ? 'CANCELLING' : 'CANCEL COGNITIVE JOB'}</button>}
        {job.errorCode && <p role="status" className="degraded">{job.errorCode}</p>}
        {job.routeRejections?.length ? <ul className="job-route-rejections" aria-label="Model routing rejections">{job.routeRejections.map(rejection => <li key={rejection}>{rejection}</li>)}</ul> : null}
      </li>;
    })}</ul>
  </div>;
}
