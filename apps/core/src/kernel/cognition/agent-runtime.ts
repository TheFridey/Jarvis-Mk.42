import { z } from 'zod'; import { ModelGatewayError, type AgentManifest, type AgentResult, type ModelRequest, type ModelResponse, type Proposal } from '@jarvis/contracts'; import type { ModelGatewayPort } from './model-client.ts'; import { withSpan } from '@jarvis/telemetry';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { runAgentWorker } from './agent-worker-host.ts';
import type { AgentJobStore } from './agent-job-store.ts';
import { proposalInstructions, type CapabilityContract } from './proposal-instructions.ts';
export function agentJobIdentity(request: ModelRequest, manifest: AgentManifest, identityHash?: string): string {
  return createHash('sha256').update(JSON.stringify([identityHash??request,manifest.version,manifest.proposalScope,manifest.leasePolicy])).digest('hex');
}
const provenance=z.object({method:z.enum(['sensor','model','retrieval','inference','assertion','derivation','system']),producedBy:z.string(),producedOn:z.string(),producedAt:z.string().datetime(),correlationId:z.string(),derivedFromUntrusted:z.boolean(),sourceRefs:z.array(z.string()).optional(),model:z.object({id:z.string(),version:z.string()}).optional()});
const base={proposalId:z.string().min(1).max(200),correlationId:z.string().min(1).max(200),confidence:z.number().min(0).max(1),provenance};
const proposal=z.discriminatedUnion('kind',[z.object({...base,kind:z.literal('answer'),text:z.string(),citations:z.array(z.string())}),z.object({...base,kind:z.literal('clarification_request'),question:z.string(),options:z.array(z.string()).optional()}),z.object({...base,kind:z.literal('capability_invocation'),invocation:z.object({capabilityId:z.string(),capabilityVersion:z.string(),action:z.string(),input:z.unknown()}),justification:z.string()}),z.object({...base,kind:z.literal('plan'),goal:z.string(),steps:z.array(z.unknown())}),z.object({...base,kind:z.literal('draft'),artifact:z.string(),mimeType:z.string()}),z.object({...base,kind:z.literal('fact_extraction'),candidates:z.array(z.unknown())}),z.object({...base,kind:z.literal('policy_recommendation'),recommendation:z.enum(['ALLOW','DENY','REQUIRE_APPROVAL']),reasoning:z.string()}),z.object({...base,kind:z.literal('capability_draft'),manifest:z.unknown(),adapterSource:z.string(),testSource:z.string(),researchNotes:z.string(),declaredEgress:z.array(z.string())})]);
const specialistIds = ['nova','argus','atlas','daedalus','forge','hephaestus','hermes','mnemosyne','oracle','prometheus','scout','sentinel'];
export const AGENTS: Readonly<Record<string, AgentManifest>> = Object.freeze(Object.fromEntries(specialistIds.map(id => {
  const manifest = JSON.parse(readFileSync(new URL(`../../../../../agents/${id}/manifest.json`, import.meta.url), 'utf8')) as AgentManifest;
  if (manifest.id !== `agents.${id}`) throw new Error('agent manifest identity mismatch');
  return [manifest.id, manifest];
})));
export class AgentRuntime {
  private readonly active = new Map<string, AbortController>();
  private readonly drains = new Set<Promise<void>>();
  private readonly owner = randomUUID();
  constructor(private readonly gateway: ModelGatewayPort, private readonly now: () => string, private readonly jobs?: AgentJobStore, private readonly capabilityContracts: () => CapabilityContract[] = () => []) {}
  async reap(): Promise<void> { await this.jobs?.reap(); }
  async canRecover(jobId: string, principalId: string, agentId: string): Promise<boolean> {
    if (!this.jobs || this.active.has(jobId)) return false;
    const row = await this.jobs.get(jobId);
    return Boolean(row && row.principal_id === principalId && row.agent_id === agentId && (row.state === 'COMPLETE' || row.state === 'QUEUED' && row.remaining_wall_ms! > 0));
  }
  async cancelForPrincipal(jobId: string, principalId: string): Promise<boolean> {
    if (!this.jobs) throw new Error('durable Agent Runtime required');
    const cancelled = await this.jobs.cancel(jobId, principalId);
    if (cancelled) this.cancel(jobId);
    return cancelled;
  }

  cancel(jobId: string): boolean { const controller = this.active.get(jobId); controller?.abort('CANCELLED'); return Boolean(controller); }
  async stop(): Promise<void> { for (const controller of this.active.values()) controller.abort('KERNEL_STOPPING'); await Promise.all(this.drains); }

  async invoke(agentId: string, request: ModelRequest,onRouting?:(routing:NonNullable<ModelResponse['routing']>)=>Promise<void>, metadata?: { jobId: string; objectiveId?: string; parentJobId?: string; identityHash?: string }): Promise<{ result: AgentResult; response: ModelResponse }> {
    return withSpan('agent.invoke', {
      'jarvis.correlation_id': request.correlationId,
      'jarvis.agent.id': agentId,
      'jarvis.model.task': request.task,
    }, async () => {
      const manifest = AGENTS[agentId];
      if (!manifest) throw new Error('unknown agent');
      if (!manifest.modelHints.tasks.includes(request.task)) throw new Error('task outside agent manifest');
      if (!this.jobs && this.active.size >= 4) throw new Error('agent concurrency limit reached');
      for (const value of Object.values(request.budget)) if (!Number.isFinite(value) || value < 0) throw new Error('invalid agent budget');
      if (request.budget.maxOutput <= 0 || request.budget.maxLatencyMs === 0) throw new Error('invalid agent budget');
      if (request.budget.contextUnits > manifest.leasePolicy.maxContextUnits) throw new Error('agent context budget exceeded');
      if (Buffer.byteLength(JSON.stringify(request.input)) > 1_000_000) throw new Error('agent input exceeds transport budget');
      const outputInstructions = proposalInstructions(manifest, request.correlationId, this.now(), this.capabilityContracts());
      const bounded: ModelRequest = { ...request,
        input:{...request.input,constraints:[...request.input.constraints,`Specialist ${manifest.id}: ${manifest.role}`,`Allowed proposal kinds: ${JSON.stringify(manifest.proposalScope.kinds)}. Allowed capability proposal IDs: ${JSON.stringify(manifest.proposalScope.capabilities)}. Propose only; never execute.`,`Every proposal and provenance correlationId must equal ${JSON.stringify(request.correlationId)}.`]},
        budget: { ...request.budget,
        maxCost: Math.min(request.budget.maxCost ?? manifest.leasePolicy.maxCostUnits, manifest.leasePolicy.maxCostUnits),
        maxLatencyMs: Math.min(request.budget.maxLatencyMs ?? manifest.leasePolicy.maxWallTimeMs, manifest.leasePolicy.maxWallTimeMs),
      } };
      bounded.input.constraints.push(outputInstructions);
      let contextCeiling = bounded.budget.contextUnits;
      if (request.input.context && 'budget' in request.input.context) {
        const compiled = z.object({limitUnits:z.number().int().nonnegative(),usedUnits:z.number().int().nonnegative()}).parse(request.input.context.budget);
        if (compiled.usedUnits > compiled.limitUnits || compiled.usedUnits > bounded.budget.contextUnits || compiled.limitUnits > manifest.leasePolicy.maxContextUnits) throw new Error('compiled context exceeds agent budget');
        contextCeiling = compiled.limitUnits;
      }
      const started = this.now();
      const jobId = metadata?.jobId ?? randomUUID(), controller = new AbortController();
      if (this.active.has(jobId)) throw new Error('agent job already in progress');
      this.active.set(jobId, controller);
      let drained!: () => void;
      const drain = new Promise<void>(resolve => { drained = resolve; }); this.drains.add(drain);
      let timeout = setTimeout(() => controller.abort('WALL_BUDGET_EXCEEDED'), bounded.budget.maxLatencyMs);
      let attempt = 0, enqueued = false;
      try {
      if (this.jobs) {
        const existing = await this.jobs.enqueue({ jobId, agentId, principalId: request.principalId, correlationId: request.correlationId,
          objectiveId: metadata?.objectiveId, parentJobId: metadata?.parentJobId, task: request.task,
          hash: agentJobIdentity(request,manifest,metadata?.identityHash), wallMs: bounded.budget.maxLatencyMs!, contextUnits: contextCeiling, costLimit: bounded.budget.maxCost! });
        enqueued = true;
        if (bounded.budget.contextUnits > existing.context_units) throw new Error('recompiled context exceeds original job budget');
        bounded.budget.maxCost = Math.min(bounded.budget.maxCost!, existing.cost_limit);
        if (existing.state === 'COMPLETE' && existing.result) return existing.result as { result: AgentResult; response: ModelResponse };
        while (attempt === 0) {
          if (controller.signal.aborted) throw new Error(String(controller.signal.reason));
          const change = this.jobs.watchChanges(controller.signal);
          try {
            const lease = await this.jobs.claim(jobId, this.owner);
            if (lease) {
              attempt = lease.attempt;
              clearTimeout(timeout);
              bounded.budget.maxLatencyMs = Math.min(bounded.budget.maxLatencyMs!, lease.remaining_wall_ms!);
              timeout = setTimeout(() => controller.abort('WALL_BUDGET_EXCEEDED'), bounded.budget.maxLatencyMs);
            } else {
              const current = await this.jobs.get(jobId);
              if (current?.state !== 'QUEUED') throw new Error('agent job is not available for lease');
              if (current.remaining_wall_ms! <= 0) throw new Error('agent wall budget exceeded');
              await change.promise;
            }
          } finally { change.dispose(); }
        }
      }
      const response = await runAgentWorker({ jobId, request: bounded, gateway: this.gateway, signal: controller.signal,
        proposalScope:manifest.proposalScope,
        onSpawn: async pid => { await this.jobs?.heartbeat(jobId, this.owner, attempt, pid); await this.jobs?.update(jobId, this.owner, attempt, 'RUNNING'); },
        heartbeat: async () => { await this.jobs?.heartbeat(jobId, this.owner, attempt); },
        beforeInference: async () => { await this.jobs?.update(jobId, this.owner, attempt, 'WAITING'); },
        onRouting: async routing => { await this.jobs?.route(jobId, this.owner, attempt, routing); await onRouting?.(routing); } });
      if (response.usage.costEstimate > bounded.budget.maxCost!) throw new Error('agent cost budget exceeded');
      const envelope = response.output as { proposals?: unknown; evidence?: unknown };
      const parsed = z.array(proposal).max(32).safeParse(envelope?.proposals ?? response.output);
      if (!parsed.success) throw new Error(`invalid structured model output: ${parsed.error.issues[0]?.message ?? 'invalid proposals'}`);
      for (const p of parsed.data) {
        if (p.correlationId !== request.correlationId || p.provenance.correlationId !== request.correlationId) throw new Error('proposal correlation mismatch');
        if (!manifest.proposalScope.kinds.includes(p.kind)) throw new Error(`proposal kind ${p.kind} outside agent scope`);
        if (p.kind === 'capability_invocation' && !manifest.proposalScope.capabilities.includes(p.invocation.capabilityId)) throw new Error('capability outside agent scope');
      }
      if (new Set(parsed.data.map(p => p.proposalId)).size !== parsed.data.length) throw new Error('duplicate proposal identity');
      const contextItems = request.input.context && 'items' in request.input.context ? request.input.context.items : [];
      // Retrieval evidence the Kernel actually supplied is attested here, whatever the model chose to cite.
      const supplied = contextItems.filter(item => item.kind === 'evidence' && item.provenance.method === 'retrieval').flatMap(item => item.provenance.sourceRefs ?? []);
      const evidence = [...new Set([...supplied, ...z.array(z.string().max(4096)).max(64).parse(envelope?.evidence ?? [])])].filter(ref => ref.length <= 4096).slice(0, 64);
      // Model identifiers are local to this job, not global effect identities.
      // Seal them in the Kernel so an agent cannot collide with another job.
      const contextTainted = request.input.context && 'items' in request.input.context
        ? request.input.context.items.some(item=>item.provenance.derivedFromUntrusted) : false;
      const proposals = parsed.data.map(p=>({...p,
        proposalId:`agent-proposal:${createHash('sha256').update(JSON.stringify([jobId,p.proposalId])).digest('hex')}`,
        provenance:{...p.provenance,method:'model' as const,producedBy:agentId,producedOn:response.provenance.producedOn,producedAt:response.provenance.producedAt,derivedFromUntrusted:p.provenance.derivedFromUntrusted || response.provenance.derivedFromUntrusted || contextTainted},
      })) as Proposal[];
      const output = {
        response,
        result: {
          jobId, agentId, principalId: request.principalId,
          correlationId: request.correlationId, status: 'completed' as const, proposals,
          evidence, startedAt: started, finishedAt: this.now(),
        },
      };
      await this.jobs?.update(jobId, this.owner, attempt, 'COMPLETE', output);
      return output;
      } catch (error) {
        if (this.jobs && enqueued) {
          try { await this.jobs.finishFailure(jobId, request.principalId, this.owner, attempt, controller.signal.aborted && controller.signal.reason !== 'WALL_BUDGET_EXCEEDED' ? 'CANCELLED' : 'FAILED', controller.signal.aborted ? String(controller.signal.reason) : error instanceof ModelGatewayError ? error.code : 'WORKER_FAILED'); }
          catch (persistenceError) { throw new AggregateError([error, persistenceError], 'agent failure could not be durably recorded'); }
        }
        throw error;
      } finally { clearTimeout(timeout); this.active.delete(jobId); this.drains.delete(drain); drained(); }
    });
  }
}
