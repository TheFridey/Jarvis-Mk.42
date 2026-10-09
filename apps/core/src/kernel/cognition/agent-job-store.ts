import { AgentJobAccessError, EventNames, type Event, type AgentResult, type ModelResponse } from '@jarvis/contracts';
import type { Sql } from '@jarvis/persistence';
import type { EventManager } from '../event-fabric/event-manager.ts';

export interface AgentJobRow {
  job_id: string; agent_id: string; principal_id: string; correlation_id: string; domain_id?:string;
  state: string; attempt: number; request_hash: string; lease_owner: string | null;
  inference_started: boolean; result: unknown;
  error_code: string | null;
  remaining_wall_ms?: number;
  wall_ms: number; context_units: number; cost_limit: number;
}
/** Leases are fenced by attempt and owner. PostgreSQL time is authoritative. */
export class AgentJobStore {
  private readonly waiters = new Set<() => void>();
  constructor(private readonly sql: Sql, private readonly events: EventManager) {}
  async get(jobId: string): Promise<AgentJobRow | undefined> { const [row] = await this.sql<AgentJobRow[]>`select *,greatest(0,extract(epoch from (deadline-clock_timestamp()))*1000)::int as remaining_wall_ms from cognition.agent_jobs where job_id=${jobId}`; return row; }
  /** Install BEFORE attempting admission, avoiding a lost completion wakeup. */
  watchChanges(signal: AbortSignal): { promise: Promise<void>; dispose: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    this.waiters.add(resolve);
    const off = this.events.onAppended(event => { if (event.type === EventNames.AgentJobTransitioned) resolve(); });
    signal.addEventListener('abort', resolve, { once: true });
    if (signal.aborted) resolve();
    return { promise, dispose: () => { off(); this.waiters.delete(resolve); signal.removeEventListener('abort', resolve); } };
  }
  private async transaction<T>(fn: (tx: Sql, events: Event[]) => Promise<T>): Promise<T> {
    const committed: Event[] = [];
    const result = await this.sql.begin(tx => fn(tx as unknown as Sql, committed));
    for (const event of committed) this.events.notifyCommitted(event);
    return result as T;
  }
  private async transition(tx: Sql, row: AgentJobRow, events: Event[], errorCode?: string) {
    events.push(await this.events.emitInTx(tx, { type: EventNames.AgentJobTransitioned,
      retentionClass: 'AUDIT', privacyClass: 'INTERNAL', sourceComponent: 'agent-runtime',
      subject: { kind: 'agent-job', id: row.job_id }, actor: { kind: 'system', id: 'agent-runtime', onBehalfOf:row.principal_id },
      principalId: row.principal_id, correlationId: row.correlation_id, causationId: row.job_id,
      payload: { jobId: row.job_id, agentId: row.agent_id, state: row.state, attempt: row.attempt, ...(errorCode ? { errorCode } : {}) },
    }, false));
  }
  async enqueue(d: { jobId: string; agentId: string; principalId: string; correlationId: string;
    objectiveId?: string; parentJobId?: string; task: string; hash: string; wallMs: number; contextUnits: number; costLimit: number }) {
    return this.transaction(async (tx, events) => {
      await tx`select pg_advisory_xact_lock(424206)`;
      const [existing] = await tx<AgentJobRow[]>`select * from cognition.agent_jobs where job_id=${d.jobId} for update`;
      if (existing) {
        if (existing.request_hash !== d.hash || existing.principal_id !== d.principalId || existing.agent_id !== d.agentId || existing.correlation_id !== d.correlationId) throw new Error('agent job identity conflict');
        return existing;
      }
      const [count] = await tx<{ count: number }[]>`select count(*)::int as count from cognition.agent_jobs where state in ('QUEUED','LEASED','RUNNING','WAITING')`;
      if (count!.count >= 64) throw new Error('agent queue limit reached');
      if (d.parentJobId) {
        const [parent] = await tx<AgentJobRow[]>`select * from cognition.agent_jobs where job_id=${d.parentJobId}`;
        if (!parent || parent.principal_id !== d.principalId || parent.correlation_id !== d.correlationId) throw new Error('agent parent binding mismatch');
        const [children] = await tx<{ count: number }[]>`select count(*)::int as count from cognition.agent_jobs where parent_job_id=${d.parentJobId}`;
        const [depth] = await tx<{ count: number }[]>`with recursive ancestors as (select job_id,parent_job_id from cognition.agent_jobs where job_id=${d.parentJobId} union all select j.job_id,j.parent_job_id from cognition.agent_jobs j join ancestors a on j.job_id=a.parent_job_id) select count(*)::int as count from ancestors`;
        if (children!.count >= 4 || depth!.count >= 3) throw new Error('agent fan-out or depth limit reached');
      }
      const [row] = await tx<AgentJobRow[]>`insert into cognition.agent_jobs(job_id,agent_id,principal_id,correlation_id,objective_id,parent_job_id,task_class,request_hash,state,wall_ms,context_units,cost_limit,deadline) values(${d.jobId},${d.agentId},${d.principalId},${d.correlationId},${d.objectiveId ?? null},${d.parentJobId ?? null},${d.task},${d.hash},'QUEUED',${d.wallMs},${d.contextUnits},${d.costLimit},clock_timestamp()+${d.wallMs}*interval '1 millisecond') returning *`;
      await this.transition(tx, row!, events); return row!;
    });
  }
  async claim(jobId: string, owner: string): Promise<AgentJobRow | undefined> {
    return this.transaction(async (tx, events) => {
      await tx`select pg_advisory_xact_lock(424206)`;
      const [count] = await tx<{ count: number }[]>`select count(*)::int as count from cognition.agent_jobs where state in ('LEASED','RUNNING','WAITING')`;
      if (count!.count >= 4) return undefined;
      const [row] = await tx<AgentJobRow[]>`update cognition.agent_jobs set state='LEASED',lease_owner=${owner},lease_expiry=least(deadline,clock_timestamp()+interval '10 seconds'),attempt=attempt+1,started_at=coalesce(started_at,clock_timestamp()),last_heartbeat=clock_timestamp() where job_id=${jobId} and state='QUEUED' and deadline>clock_timestamp() and attempt<2 returning *, greatest(0,extract(epoch from (deadline-clock_timestamp()))*1000)::int as remaining_wall_ms`;
      if (row) await this.transition(tx, row, events); return row;
    });
  }
  async update(jobId: string, owner: string, attempt: number, state: 'RUNNING'|'WAITING'|'COMPLETE'|'FAILED'|'CANCELLED', data?: { result: AgentResult; response: ModelResponse }, errorCode?: string) {
    return this.transaction(async (tx, events) => {
      const [row] = await tx<AgentJobRow[]>`update cognition.agent_jobs set state=${state},inference_started=inference_started or ${state === 'WAITING'},result=${state === 'COMPLETE' ? JSON.stringify(data) : null},error_code=${errorCode ?? null},finished_at=case when ${['COMPLETE','FAILED','CANCELLED'].includes(state)} then clock_timestamp() else null end where job_id=${jobId} and lease_owner=${owner} and attempt=${attempt} and state in ('LEASED','RUNNING','WAITING') and lease_expiry>clock_timestamp() and deadline>clock_timestamp() returning *`;
      if (!row) throw new Error('agent lease lost');
      if (data) await tx`update cognition.agent_jobs set proposal_count=${data.result.proposals.length},evidence_refs=${JSON.stringify(data.result.evidence)},model_route=${data.response.routing ? JSON.stringify(data.response.routing) : null} where job_id=${jobId}`;
      await this.transition(tx, row, events);
    });
  }
  async heartbeat(jobId: string, owner: string, attempt: number, pid?: number) {
    const rows = await this.sql`update cognition.agent_jobs set last_heartbeat=clock_timestamp(),lease_expiry=least(deadline,clock_timestamp()+interval '10 seconds'),worker_pid=coalesce(${pid ?? null},worker_pid) where job_id=${jobId} and lease_owner=${owner} and attempt=${attempt} and state in ('LEASED','RUNNING','WAITING') and lease_expiry>clock_timestamp() and deadline>clock_timestamp() returning job_id`;
    if (!rows.length) throw new Error('agent lease lost');
  }
  async route(jobId: string, owner: string, attempt: number, routing: NonNullable<ModelResponse['routing']>) {
    const rows = await this.sql`update cognition.agent_jobs set model_route=${JSON.stringify(routing)} where job_id=${jobId} and lease_owner=${owner} and attempt=${attempt} and state in ('RUNNING','WAITING') and lease_expiry>clock_timestamp() and deadline>clock_timestamp() returning job_id`;
    if (!rows.length) throw new Error('agent lease lost');
  }
  async cancel(jobId: string, principalId: string): Promise<boolean> {
    return this.transaction(async (tx, events) => {
      const [bound] = await tx<AgentJobRow[]>`select * from cognition.agent_jobs where job_id=${jobId} for update`;
      if (!bound || bound.principal_id !== principalId) throw new AgentJobAccessError();
      if (bound.state === 'CANCELLED') return true;
      if (!['QUEUED','LEASED','RUNNING','WAITING','BLOCKED'].includes(bound.state)) return false;
      const [row] = await tx<AgentJobRow[]>`update cognition.agent_jobs set state='CANCELLED',error_code='OPERATOR_CANCELLED',finished_at=clock_timestamp() where job_id=${jobId} returning *`;
      await this.transition(tx, row!, events, 'OPERATOR_CANCELLED'); return true;
    });
  }
  async finishFailure(jobId: string, principalId: string, owner: string, attempt: number, state: 'FAILED'|'CANCELLED', errorCode: string) {
    await this.transaction(async (tx, events) => {
      const [row] = await tx<AgentJobRow[]>`select * from cognition.agent_jobs where job_id=${jobId} for update`;
      if (!row || row.principal_id !== principalId || row.attempt !== attempt) throw new Error('agent lease lost');
      // An explicit cancellation or expiry already durably records this failure.
      if (['CANCELLED','FAILED','BLOCKED'].includes(row.state)) return;
      if (attempt > 0 && row.lease_owner !== owner) throw new Error('agent lease lost');
      if (!['QUEUED','LEASED','RUNNING','WAITING'].includes(row.state)) throw new Error('agent job is terminal');
      const [finished] = await tx<AgentJobRow[]>`update cognition.agent_jobs set state=${state},error_code=${errorCode},finished_at=clock_timestamp() where job_id=${jobId} returning *`;
      await this.transition(tx, finished!, events, errorCode);
    });
  }
  async reap(): Promise<void> {
    await this.transaction(async (tx, events) => {
      const rows = await tx<AgentJobRow[]>`update cognition.agent_jobs set state=case when deadline<=clock_timestamp() then 'FAILED' when inference_started then 'BLOCKED' when attempt>=2 then 'FAILED' else 'QUEUED' end,error_code=case when deadline<=clock_timestamp() then 'WALL_BUDGET_EXCEEDED' when inference_started then 'INFERENCE_OUTCOME_UNKNOWN' when attempt>=2 then 'RETRY_LIMIT' else 'LEASE_EXPIRED' end,lease_owner=null,lease_expiry=null,worker_pid=null where (state in ('LEASED','RUNNING','WAITING') and lease_expiry<=clock_timestamp()) or (state='QUEUED' and deadline<=clock_timestamp()) returning *`;
      for (const row of rows) {
        if (row.state !== 'QUEUED') await tx`update cognition.agent_jobs set finished_at=clock_timestamp() where job_id=${row.job_id}`;
        await this.transition(tx, row, events, row.error_code ?? undefined);
      }
    });
    // The existing Scheduler liveness sweep also reconciles admission after
    // another Kernel's commit or a delayed fabric notification. No tight poll.
    for (const resolve of this.waiters) resolve();
  }
}
