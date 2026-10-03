'use client';
import { AGENT_ORCHESTRATION_GROUPS, type OperatingAgentJob } from '@jarvis/scene';
import { useState } from 'react';
export function AgentObservatory({ jobs, live, generatedAt, onCancel }: { jobs: OperatingAgentJob[]; live: boolean; generatedAt?: string; onCancel?:(jobId:string)=>Promise<void> }) {
  const [pending, setPending] = useState<string>();
  const [message, setMessage] = useState('');
  const cancel = async (jobId:string) => {
    if (!live || !onCancel) return;
    setPending(jobId); setMessage('');
    try { await onCancel(jobId); setMessage('Cancellation processed by Kernel. Awaiting authoritative projection.'); }
    catch(error) { setMessage(error instanceof Error?error.message:String(error)); }
    finally { setPending(undefined); }
  };
  return <details className="agent-observatory"><summary>AGENT OBSERVATORY · {live?'LIVE':'STALE / UNAVAILABLE'} · {jobs.length} RECENT JOBS</summary>
    <p>JARVIS → orchestration group → specialist → model → proposal. Groups confer no authority. Elapsed time is measured at the last projection.</p>
    {!live&&<p role="status">Disconnected: these records are not live.</p>}
    {message&&<p role="status">{message}</p>}
    {jobs.length===0&&<p>No observed agent jobs. The specialist roster is not simulated activity.</p>}
    {jobs.length>0&&<svg className="agent-graph" viewBox={`0 0 400 ${Math.min(jobs.length,12)*44}`} role="img" aria-label="Observed agent jobs and recorded parent dependencies">{jobs.slice(0,12).map((job,index)=>{const parent=jobs.slice(0,12).findIndex(candidate=>candidate.jobId===job.parentJobId);return <g key={job.jobId}>{parent>=0&&<path d={`M 14 ${parent*44+18} L 14 ${index*44+18} L 28 ${index*44+18}`} fill="none" stroke="currentColor" opacity=".35"/>}<circle cx="28" cy={index*44+18} r="3" fill="currentColor" opacity={live&&job.activityConfirmed?1:.35}/><text x="42" y={index*44+21} fill="currentColor" fontSize="11">{job.agentId.replace('agents.','')} · {live?job.state:'LAST OBSERVED'}{job.activityConfirmed===false?' · UNCONFIRMED':''}</text></g>})}</svg>}
    <ul>{jobs.map(job=>{
      const groups=Object.entries(AGENT_ORCHESTRATION_GROUPS).filter(([,agents])=>(agents as readonly string[]).includes(job.agentId)).map(([group])=>group);
      const end=job.finishedAt??generatedAt;
      const elapsed=job.startedAt&&end?Math.max(0,Date.parse(end)-Date.parse(job.startedAt)):undefined;
      return <li key={job.jobId}><strong>JARVIS → {groups.join(' / ')||'SPECIALIST'} → {job.agentId.replace('agents.','')}</strong>
        <p>STAGE {job.activityStage??job.state} · COGNITIVE JOB {job.state} · {job.taskClass} · MODEL {job.selectedModelId??'NOT OBSERVED'}</p>
        {['RUNNING','WAITING'].includes(job.state)&&job.activityConfirmed===false&&<p>Worker lease unconfirmed. No live activity is implied.</p>}
        <dl><dt>Job / attempt</dt><dd>{job.jobId} / {job.attempt}</dd><dt>Elapsed / wall budget</dt><dd>{elapsed===undefined?'NOT STARTED':`${(elapsed/1000).toFixed(1)}s`} / {job.budget.wallMs/1000}s</dd><dt>Context / cost ceiling</dt><dd>{job.budget.contextUnits} units / {job.budget.costLimit} abstract cost units</dd><dt>Objective</dt><dd>{job.objectiveId??'NONE'}</dd><dt>Parent dependency</dt><dd>{job.parentJobId??'ROOT'}</dd><dt>Capability proposals</dt><dd>{job.proposedCapabilities.join(', ')||'NONE'}</dd></dl>
        <p>{job.proposalCount} validated proposals · {job.evidenceCount??job.evidenceRefs.length} evidence refs{job.evidenceRefsTruncated?' (reference sample bounded)':''}. COMPLETE means cognitive output, not verified effects.</p>
        <ul>{job.capabilityActivity?.map(effect=><li key={effect.invocationId}>→ {effect.capabilityId} · {effect.state} · {effect.invocationId}</li>)}</ul>
        {onCancel&&['QUEUED','LEASED','RUNNING','WAITING','BLOCKED'].includes(job.state)&&<button disabled={!live||Boolean(pending)} onClick={()=>void cancel(job.jobId)}>{pending===job.jobId?'CANCELLING':'CANCEL COGNITIVE JOB'}</button>}
        {job.errorCode&&<p role="status">{job.errorCode}</p>}
      </li>;
    })}</ul>
  </details>;
}
