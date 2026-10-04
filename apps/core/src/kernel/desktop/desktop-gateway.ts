import type { SystemTelemetry } from '../telemetry/system-telemetry.ts';
import type { Sql } from '@jarvis/persistence';
import type { Capability, CapabilityInvocationProposal, CognitionResponse } from '@jarvis/contracts';
import type {
  DesktopApproval,
  DesktopApprovalCommand,
  DesktopKernelSnapshot,
  DesktopProposalCommand,
  DesktopProposalResponse,
  DesktopCognitionCommand,
  DesktopAgentCancelCommand,
  DesktopAgentCancelResponse,
  PresentationState,
  SemanticScene,
  OperatingModelRun,
  OperatingAgentJob,
  OperatingObjective,
  InteractionState,
  WorkState,
} from '@jarvis/scene';
import type { DiagnosticsService } from '../diagnostics/diagnostics-service.ts';
import type { StateManager } from '../state/state-manager.ts';
import type { SessionManager } from '../session/session-manager.ts';
import type { ApprovalManager } from '../permission/approval-manager.ts';
import type { AgencyIngress } from '../agency-ingress/agency-ingress.ts';
import type { CognitionOrchestrator } from '../cognition/cognition-orchestrator.ts';
import type { BusinessIntelligence } from '../integrations/intelligence.ts';
import type { IdGen } from '../../runtime/ids.ts';
import { presentationSystemMode } from './presentation-state.ts';
import type { CompanionService } from '../experience/companion-service.ts';

interface InvocationRow {
  invocation_id: string; capability_id: string; action: string; state: DesktopKernelSnapshot['capabilityActivity'][number]['state'];
  origin_actor: { id?: string; kind?: string }; risk_class: DesktopKernelSnapshot['capabilityActivity'][number]['risk'];
  proposal: CapabilityInvocationProposal | null; final_outcome: string | null; updated_at: string; finished_at: string | null;
  manifest: Capability | null;
}
interface CognitionRow { request_id:string; correlation_id:string; agent_id:string; model_id:string|null; status:'running'|'completed'|'failed'; response:CognitionResponse|null; task_class:string|null;privacy_class:string|null;objective_ref:string|null;workflow_ref:string|null;routing_observability:OperatingModelRun['routing']|null;usage_observability:OperatingModelRun['usage']|null;first_token_at:string|null;error_code:string|null; context_units:number; output_units:number; cost_estimate:number; latency_ms:number; created_at:string; finished_at:string|null; }
interface ObjectiveRow { objective_id:string; statement:string; status:string; priority:number; updated_at:string; }
interface JobRow {
  job_id:string;agent_id:string;correlation_id:string;objective_id:string|null;parent_job_id:string|null;task_class:string;
  state:OperatingAgentJob['state'];attempt:number;started_at:string|null;finished_at:string|null;last_heartbeat:string|null;
  deadline:string;wall_ms:number;context_units:number;cost_limit:number;model_route:OperatingModelRun['routing']|null;
  proposal_count:number;evidence_refs:string[];error_code:string|null;result:{result:{proposals:CapabilityInvocationProposal[]}}|null;
  activity_confirmed:boolean;inference_started:boolean;
}

export type DesktopCommandResult<T> = { ok: true; value: T } | { ok: false; code: 'state_version_conflict' | 'approval_rejected'; currentStateVersion: number };

export class DesktopGateway {
  private companion?:CompanionService;
  setCompanion(service:CompanionService){this.companion=service;}
  constructor(private readonly deps: { sql: Sql; diagnostics: DiagnosticsService; state: StateManager; sessions: SessionManager; approvals: ApprovalManager; agency: AgencyIngress; cognition: CognitionOrchestrator; business?: BusinessIntelligence; ids: IdGen; nodeId: string; systemTelemetry?: SystemTelemetry; voiceAudio?:()=>import('@jarvis/contracts').VoiceAudioState|undefined;observeScene?:(principalId:string,nodeId:string,observation:{focusedId?:string;selectedIds:string[]})=>void;referentFocus?:()=>import('../vision/perception-context.ts').ReferentFocus|undefined }) {}

  // RC-audit: static-token `authenticate` removed — DiagnosticsHttp enforces
  // session-bound credentials (node + session + scope) for every /desktop route.

  async observeSelection(principalId:string,nodeId:string,observation:{focusedId?:string;selectedIds:string[]}){const snapshot=await this.snapshot();if(snapshot.principalId!==principalId)throw new Error('scene principal mismatch');const ids=[...observation.selectedIds,...(observation.focusedId?[observation.focusedId]:[])];if(ids.some(id=>!snapshot.scene.objects.some(object=>object.id===id)))throw new Error('unknown scene object');this.deps.observeScene?.(principalId,nodeId,observation);}
  async snapshot(): Promise<DesktopKernelSnapshot> {
    const state=await this.deps.state.view();
    const principalId = (state.slices.active_principal?.value as { principalId?: string | null } | undefined)?.principalId ?? null;
    const [diagnostics, allSessions, allPending, activity, cognitionRows, objectiveRows, jobRows] = await Promise.all([
      this.deps.diagnostics.report(), this.deps.sessions.listActive(), this.deps.approvals.listPending(),
      this.deps.sql<InvocationRow[]>`select i.invocation_id, i.capability_id, i.action, i.state, i.origin_actor, i.risk_class, i.proposal, i.final_outcome, coalesce(i.finished_at, i.started_at, i.created_at) as updated_at, i.finished_at, cv.manifest from agency.invocations i left join agency.capability_versions cv on cv.capability_id=i.capability_id and cv.version=i.capability_version where i.principal_id=${principalId} order by i.created_at desc limit 30`,
      this.deps.sql<CognitionRow[]>`select request_id,correlation_id,agent_id,model_id,status,response,task_class,privacy_class,objective_ref,workflow_ref,routing_observability,usage_observability,first_token_at,error_code,context_units,output_units,cost_estimate,latency_ms,created_at,finished_at from cognition.runs r where r.principal_id=${principalId} order by exists(select 1 from cognition.agent_jobs j where j.job_id=r.request_id and j.state in ('RUNNING','WAITING') and j.lease_expiry>clock_timestamp()) desc,(status='running') desc,created_at desc limit 100`,
      this.deps.sql<ObjectiveRow[]>`select objective_id,statement,status,priority,updated_at from projections.objectives where principal_id=${principalId} and status in ('proposed','active','blocked','paused') order by priority desc,created_at limit 30`,
      this.deps.sql<JobRow[]>`select *, (state in ('RUNNING','WAITING') and lease_expiry>clock_timestamp() and worker_pid is not null) as activity_confirmed from cognition.agent_jobs where principal_id=${principalId} order by (state in ('QUEUED','LEASED','RUNNING','WAITING')) desc,created_at desc limit 100`,
    ]);
    const sessions=allSessions.filter(session=>session.principalId===principalId);
    const pending=allPending.filter(approval=>approval.principalId===principalId);
    const objectiveId = (state.slices.active_objective?.value as { objectiveId?: string | null } | undefined)?.objectiveId ?? null;
    const workspaceId = (state.slices.active_workspace?.value as { workspaceId?: string | null } | undefined)?.workspaceId ?? null;
    const contextId = (state.slices.active_context?.value as { contextId?: string | null } | undefined)?.contextId ?? null;
    const alertIds = (state.slices.active_alerts?.value as { alertIds?: string[] } | undefined)?.alertIds ?? [];
    const byInvocation = new Map(activity.map((row) => [row.invocation_id, row]));
    const approvals: DesktopApproval[] = pending.map((approval) => {
      const row = byInvocation.get(approval.invocationId); const input = row?.proposal?.invocation.input;
      const args = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : { value: input };
      return { ...approval, actor: row?.origin_actor?.id ?? approval.principalId ?? 'unknown', resource: this.resource(args), reason: row?.proposal?.justification ?? approval.summary, scopes: row?.manifest?.actions.find(action=>action.name===row.action)?.requiredScopes ?? row?.manifest?.requiredScopes ?? [], arguments: args };
    });
    const capabilityActivity = activity.map((row) => ({ invocationId: row.invocation_id, capabilityId: row.capability_id, action: row.action, actor: row.origin_actor?.id ?? 'unknown', risk: row.risk_class, state: row.state, updatedAt: new Date(row.updated_at).toISOString(), ...(row.final_outcome ? { finalOutcome: row.final_outcome } : {}) }));
    const policyDenials = activity.filter((row) => row.state === 'DENIED').map((row) => ({ invocationId: row.invocation_id, capabilityId: row.capability_id, action: row.action, reason: row.final_outcome ?? 'Denied by Kernel policy or permissions', at: new Date(row.updated_at).toISOString() }));
    const scene = this.scene({ stateVersion: state.stateVersion, principalId, objectiveId, workspaceId, contextId, alertIds, diagnostics, activity: capabilityActivity });
    const modelRuns: OperatingModelRun[] = cognitionRows.map((row) => ({ requestId:row.request_id,correlationId:row.correlation_id,modelId:row.model_id,agentId:row.agent_id,status:row.status,startedAt:new Date(row.created_at).toISOString(),...(row.task_class?{taskClass:row.task_class}:{}),...(row.privacy_class?{privacyClass:row.privacy_class}:{}),...(row.objective_ref?{objectiveRef:row.objective_ref}:{}),...(row.workflow_ref?{workflowRef:row.workflow_ref}:{}),...(row.routing_observability?{routing:row.routing_observability}:{}),...(row.usage_observability?{usage:row.usage_observability}:{}),...(row.first_token_at?{firstTokenAt:new Date(row.first_token_at).toISOString()}:{}),...(row.error_code?{errorClass:row.error_code}:{}),...(row.finished_at?{finishedAt:new Date(row.finished_at).toISOString()}:{}),...((row.status==='completed'&&!['nova:operating-picture','sentinel:measured-telemetry'].includes(row.model_id??''))||row.usage_observability?{latencyMs:row.latency_ms,contextUnits:row.context_units,outputUnits:row.output_units,costEstimate:row.cost_estimate}:{})}));
    const tasks: OperatingObjective[] = objectiveRows.map((row) => ({ id: row.objective_id, statement: row.statement, status: row.status, priority: row.priority, updatedAt: new Date(row.updated_at).toISOString() }));
    const jobsById = new Map(jobRows.map(job=>[job.job_id,job]));
    for (const run of modelRuns) { const job=jobsById.get(run.requestId); run.activityConfirmed=Boolean(job?.activity_confirmed&&job.inference_started); }
    const activeModels = modelRuns.filter(run=>run.status==='running'&&run.activityConfirmed);
    const voiceAudio=this.deps.voiceAudio?.();
    const interactionState:InteractionState = voiceAudio?.tts==='playing'||voiceAudio?.tts==='synthesizing'?'RESPONDING':this.interactionState(diagnostics.mode, activeModels);
    const baseWorkState = this.workState(capabilityActivity, approvals, tasks, activeModels);
    const workState: WorkState = baseWorkState!=='IDLE'?baseWorkState:jobRows.some(job=>job.state==='BLOCKED')?'BLOCKED':jobRows.some(job=>['QUEUED','LEASED','RUNNING','WAITING'].includes(job.state))?'WAITING':'IDLE';
    const telemetry = diagnostics.telemetry;
    const systemTelemetry = await this.deps.systemTelemetry?.snapshot();
    if(systemTelemetry){
      const reading=(value:number|null,unit:string)=>({value,unit,status:value===null?'unavailable' as const:'available' as const,observedAt:value===null?null:diagnostics.generatedAt});
      systemTelemetry.readings.outbox=reading(diagnostics.events.outboxPending,'events');
      systemTelemetry.readings.eventDepth=reading(diagnostics.events.totalAppended,'events');
      const nats=diagnostics.dependencies.find(d=>d.name==='nats');
      systemTelemetry.readings.nats??=reading(nats?Number(nats.status==='HEALTHY'):null,'healthy');
      const gateway=diagnostics.dependencies.find(d=>d.name==='model-gateway');
      systemTelemetry.readings.gateway=reading(gateway?Number(gateway.status==='HEALTHY'):null,'healthy');
      systemTelemetry.readings.models=reading(typeof gateway?.detail?.models==='number'?gateway.detail.models:null,'models');
      const latest=systemTelemetry.history.at(-1);if(latest)latest.values=Object.fromEntries(Object.entries(systemTelemetry.readings).map(([key,r])=>[key,r.value]));
      systemTelemetry.overallHealth=diagnostics.health.overall==='HEALTHY'?'healthy':diagnostics.health.overall==='OFFLINE'||diagnostics.health.overall==='DEGRADED'?'degraded':'unknown';
    }
    const presenceValue = (state.slices.presence?.value as { state?:string; confidence?:number; observedAt?:string } | undefined) ?? {};
    const activeCapabilities = capabilityActivity.filter((item) => !['COMPLETED','REJECTED','DENIED','ABORTED','FAILED','VERIFICATION_FAILED','ROLLED_BACK','PARTIALLY_COMPLETED'].includes(item.state));
    const cognitionResponses: CognitionResponse[] = [];
    let responseBytes = 0, cognitionResponseBodiesTruncated = false;
    for (const row of cognitionRows) if (row.response) {
      const size = Buffer.byteLength(JSON.stringify(row.response));
      if (responseBytes + size > 64_000) { cognitionResponseBodiesTruncated = true; continue; }
      cognitionResponses.push(row.response); responseBytes += size;
    }
    return {
      scalesmiths:principalId?this.deps.business?.picture(principalId):undefined,
      schemaVersion: 2, operatingPictureVersion: 1, generatedAt: diagnostics.generatedAt, voiceAudio,referentFocus:this.deps.referentFocus?.(),
      stateVersion: state.stateVersion, sceneVersion: scene.version, systemMode: presentationSystemMode(diagnostics.mode),
      interactionState, workState, principal: { id: principalId, status: principalId ? 'active' : 'unassigned' },
      presence: { status: presenceValue.state === 'present' ? 'present' : presenceValue.state === 'away' ? 'away' : 'unknown', ...(typeof presenceValue.confidence === 'number' ? { confidence: presenceValue.confidence } : {}), ...(presenceValue.observedAt ? { observedAt: presenceValue.observedAt } : {}) },
      ...(tasks.find((task) => task.id === objectiveId) ? { activeObjective: tasks.find((task) => task.id === objectiveId)! } : {}), activeTasks: tasks,
      activeModels, recentModelRuns: modelRuns,
      activeAgents: jobRows.filter(job=>job.activity_confirmed&&job.started_at).map(job=>({agentId:job.agent_id,requestId:job.job_id,status:'running',startedAt:new Date(job.started_at!).toISOString()})),
      agentJobs: jobRows.map(row => {
        const proposalIds = new Set(row.result?.result.proposals.map(proposal=>proposal.proposalId)??[]);
        const effects = activity.filter(invocation=>invocation.proposal && proposalIds.has(invocation.proposal.proposalId));
        const activityStage: OperatingAgentJob['activityStage'] = effects.some(effect=>effect.state==='AWAITING_APPROVAL')?'WAITING_APPROVAL':effects.some(effect=>effect.state==='VERIFYING')?'VERIFYING':row.state;
        return { jobId:row.job_id,agentId:row.agent_id,correlationId:row.correlation_id,taskClass:row.task_class,state:row.state,attempt:row.attempt,activityStage,activityConfirmed:row.activity_confirmed,
        capabilityActivity:effects.map(effect=>({invocationId:effect.invocation_id,capabilityId:effect.capability_id,state:effect.state})),
        ...(row.objective_id?{objectiveId:row.objective_id}:{}),...(row.parent_job_id?{parentJobId:row.parent_job_id}:{}),
        ...(row.started_at?{startedAt:new Date(row.started_at).toISOString()}:{}),...(row.finished_at?{finishedAt:new Date(row.finished_at).toISOString()}:{}),...(row.last_heartbeat?{lastHeartbeat:new Date(row.last_heartbeat).toISOString()}:{}),
        deadline:new Date(row.deadline).toISOString(),budget:{wallMs:row.wall_ms,contextUnits:row.context_units,costLimit:row.cost_limit},
        ...(row.model_route?.selectedModelId?{selectedModelId:row.model_route.selectedModelId}:{}),
        ...(row.state==='FAILED'&&!row.model_route?.selectedModelId&&row.model_route?.candidates.some(candidate=>candidate.state==='UNAVAILABLE')?{routeRejections:[...new Set(row.model_route.candidates.filter(candidate=>candidate.state==='UNAVAILABLE').map(candidate=>`${candidate.modelId}: ${candidate.reason}`.slice(0,200)))].slice(0,6)}:{}),
        proposalCount:row.proposal_count,evidenceCount:row.evidence_refs.length,
        evidenceRefs:row.evidence_refs.filter(ref=>Buffer.byteLength(ref)<=256).slice(0,8),evidenceRefsTruncated:row.evidence_refs.length>8||row.evidence_refs.some(ref=>Buffer.byteLength(ref)>256),
        proposedCapabilities:row.result?.result.proposals.filter(p=>p.kind==='capability_invocation').map(p=>p.invocation.capabilityId)??[],...(row.error_code?{errorCode:row.error_code}:{}) }; }),
      activeCapabilities, systemHealth: diagnostics.health,
      telemetrySummary: { availability: systemTelemetry ? (Object.values(systemTelemetry.readings).some(r=>r.status==='available')?'partial':'unavailable') : telemetry?.enabled ? (telemetry.started ? 'available' : 'partial') : 'unavailable', generatedAt: diagnostics.generatedAt, eventRatePerMinute: diagnostics.events.ratePerMinute, ...(systemTelemetry?{system:systemTelemetry}:{}), traceExport: telemetry?.lastExportAt ? 'active' : telemetry?.started ? 'unknown' : 'inactive' },
      pendingApprovals: approvals, conversationActivity: { activeSessionIds: sessions.map((session) => session.id), activeRunIds: modelRuns.filter((run) => run.status === 'running').map((run) => run.requestId), recentResponseIds: cognitionRows.filter((row) => row.response).map((row) => row.request_id) },
      selectedContext: { contextId, projectId: workspaceId }, principalId, diagnostics, state, sessions,
      notifications: alertIds, objectives: tasks.map((task) => task.id), cognitionResponses, cognitionResponseBodiesTruncated,
      capabilityActivity, policyDenials, approvals, scene, selectedProjectId: workspaceId, contextId,
    };
  }

  async cognize(command:DesktopCognitionCommand,sourceNodeId=this.deps.nodeId):Promise<DesktopCommandResult<CognitionResponse>> { const state=await this.deps.state.view(); if(command.expectedStateVersion!==state.stateVersion)return{ok:false,code:'state_version_conflict',currentStateVersion:state.stateVersion}; const principalId=(state.slices.active_principal.value as {principalId:string|null}).principalId;if(!principalId)return{ok:false,code:'approval_rejected',currentStateVersion:state.stateVersion}; if(this.companion){const response=await this.companion.converse({principalId,nodeId:sourceNodeId},command,command.conversationId);if(response.result)return{ok:true,value:response.result};} const correlationId=this.deps.ids.ulid(); return {ok:true,value:await this.deps.cognition.submit({requestId:command.commandId,principalId,correlationId,input:command.input,agentId:command.agentId??'agents.oracle',task:command.task??'reason',locality:command.locality??'any'})}; }

  async submit(command: DesktopProposalCommand): Promise<DesktopCommandResult<DesktopProposalResponse>> {
    const state = await this.deps.state.view();
    if (command.expectedStateVersion !== state.stateVersion) return { ok: false, code: 'state_version_conflict', currentStateVersion: state.stateVersion };
    const principalId = (state.slices.active_principal.value as { principalId: string | null }).principalId;
    if (!principalId) return { ok: false, code: 'approval_rejected', currentStateVersion: state.stateVersion };
    const result = await this.deps.agency.submit(command.proposal, { principalId, authenticated: true });
    return { ok: true, value: { commandId: command.commandId, stateVersion: (await this.deps.state.view()).stateVersion, result } };
  }

  /**
   * RC-audit hardening: `authTrustLevel` is now supplied by the authenticated
   * ingress instead of being hardcoded to 'verified'. The HTTP layer already
   * requires a `strong`, <5-minute-old, session-bound credential for
   * /desktop/approvals, but hardcoding the trust level here meant the security
   * property lived entirely in the caller — any future route reaching this method
   * would have silently inherited 'verified'. Now it fails closed by default.
   */
  async decide(command: DesktopApprovalCommand, auth?: { authTrustLevel: 'trusted' | 'verified' }): Promise<DesktopCommandResult<{ accepted: true; outcome: string }>> {
    const state = await this.deps.state.view();
    if (command.expectedStateVersion !== state.stateVersion) return { ok: false, code: 'state_version_conflict', currentStateVersion: state.stateVersion };
    const principalId = (state.slices.active_principal.value as { principalId: string | null }).principalId;
    const request = await this.deps.approvals.forInvocation(command.invocationId);
    if (!principalId || request?.id !== command.approvalId) return { ok: false, code: 'approval_rejected', currentStateVersion: state.stateVersion };
    const input = { invocationId: command.invocationId, operatorId: principalId, sessionId: `desktop:${this.deps.nodeId}`, nonce: command.nonce, version: command.version };
    const accepted = command.decision === 'approve'
      ? await this.deps.approvals.approve({ ...input, authTrustLevel: auth?.authTrustLevel ?? 'trusted', ...(command.confirmationPhrase ? { confirmationPhrase: command.confirmationPhrase } : {}) })
      : await this.deps.approvals.deny(input);
    if (!accepted) return { ok: false, code: 'approval_rejected', currentStateVersion: state.stateVersion };
    const [row] = await this.deps.sql<{ proposal: CapabilityInvocationProposal | null }[]>`select proposal from agency.invocations where invocation_id=${command.invocationId} and principal_id=${principalId} limit 1`;
    if (!row?.proposal) return { ok: false, code: 'approval_rejected', currentStateVersion: state.stateVersion };
    const resumed = await this.deps.agency.submit(row.proposal, { principalId, authenticated: true });
    return { ok: true, value: { accepted: true, outcome: resumed.outcome } };
  }

  private resource(args: Record<string, unknown>): string { return String(args.path ?? args.resource ?? args.resourceRef ?? args.url ?? args.root ?? 'unspecified'); }

  private scene(input: { stateVersion: number; principalId: string | null; objectiveId: string | null; workspaceId: string | null; contextId: string | null; alertIds: string[]; diagnostics: Awaited<ReturnType<DiagnosticsService['report']>>; activity: DesktopKernelSnapshot['capabilityActivity'] }): SemanticScene {
    const now = input.diagnostics.generatedAt; const presentation = this.presentation(input.diagnostics.mode, input.stateVersion, input.diagnostics.ok, input.activity);
    const objects: SemanticScene['objects'] = [
      { id: 'core', kind: 'jarvis-core', title: 'JARVIS', semanticRole: 'system-presence', monitorId: 'primary', position: { x: 760, y: 300 }, size: { width: 400, height: 400 }, zIndex: 1, state: 'focused', pinned: true, dismissible: false, resourceRefs: [], updatedAt: now, data: { activity: input.activity.slice(0, 3).map((item) => item.action), phrase: input.diagnostics.ok ? `Kernel ${input.diagnostics.mode.toLowerCase()}.` : 'Kernel reports degraded operation.' } },
      { id: 'infrastructure', kind: 'infrastructure', title: 'Infrastructure', semanticRole: 'system-topology', monitorId: 'primary', position: { x: 1230, y: 555 }, size: { width: 430, height: 285 }, zIndex: 2, state: 'expanded', pinned: false, dismissible: false, resourceRefs: input.diagnostics.nodes.ids.map((id) => `node:${id}`), updatedAt: now, data: { eyebrow: 'LIVE SYSTEM FIELD', nodes: input.diagnostics.nodes.connected, healthy: input.diagnostics.dependencies.filter((d) => d.status === 'HEALTHY').length, degraded: input.diagnostics.dependencies.filter((d) => d.status !== 'HEALTHY').length } },
    ];
    if (input.objectiveId) objects.push({ id: 'objectives', kind: 'objective', title: 'Active objective', semanticRole: 'desired-state', monitorId: 'primary', position: { x: 1180, y: 146 }, size: { width: 410, height: 270 }, zIndex: 2, state: 'expanded', pinned: false, dismissible: true, resourceRefs: [`objective:${input.objectiveId}`], updatedAt: now, data: { eyebrow: 'KERNEL OBJECTIVE', primary: input.objectiveId, next: 'Awaiting objective projection' } });
    if (input.alertIds.length) objects.push({ id: 'alerts', kind: 'alert', title: 'Active alerts', semanticRole: 'attention-required', monitorId: 'primary', position: { x: 165, y: 178 }, size: { width: 405, height: 250 }, zIndex: 3, state: 'expanded', pinned: true, dismissible: false, resourceRefs: input.alertIds.map((id) => `alert:${id}`), updatedAt: now, data: { eyebrow: 'KERNEL ALERTS', primary: `${input.alertIds.length} active`, signal: input.alertIds.join(', ') } });
    return { id: 'primary-workspace', principalId: input.principalId ?? 'unassigned', version: input.stateVersion, presentation, monitors: [{ id: 'primary', label: 'Primary', bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 1, primary: true, connected: true }], objects, ...(input.workspaceId ? { selectedProjectId: input.workspaceId } : {}), updatedAt: now };
  }

  private presentation(mode: DesktopKernelSnapshot['diagnostics']['mode'], _version: number, ok: boolean, activity: DesktopKernelSnapshot['capabilityActivity']): PresentationState {
    if (!ok || mode === 'DEGRADED') return 'DEGRADED'; if (mode === 'GUARDIAN') return 'GUARDIAN';
    if (activity.some((item) => ['EXECUTING', 'VERIFYING', 'ROLLING_BACK'].includes(item.state))) return 'WORKING';
    if (mode === 'ENGAGED') return 'LISTENING'; if (mode === 'FOCUSED') return 'THINKING'; if (mode === 'AUTONOMOUS') return 'WORKING'; return 'DORMANT';
  }

  async cancelAgentJob(command: DesktopAgentCancelCommand, authenticatedPrincipalId: string): Promise<DesktopCommandResult<DesktopAgentCancelResponse>> {
    const state = await this.deps.state.view();
    if (command.expectedStateVersion !== state.stateVersion) return { ok:false, code:'state_version_conflict', currentStateVersion:state.stateVersion };
    return { ok:true, value:{ jobId:command.jobId, cancelled:await this.deps.cognition.cancelAgentJob(command.jobId, authenticatedPrincipalId) } };
  }


  private interactionState(mode: DesktopKernelSnapshot['diagnostics']['mode'], runs: OperatingModelRun[]): InteractionState { if (runs.some((run) => run.status === 'running')) return 'INTERPRETING'; if (mode === 'ENGAGED') return 'LISTENING'; if (mode === 'FOCUSED') return 'AWARE'; return 'DORMANT'; }
  private workState(activity: DesktopKernelSnapshot['capabilityActivity'], approvals: DesktopApproval[], tasks: OperatingObjective[], runs: OperatingModelRun[]): WorkState { if (activity.some((item) => item.state === 'VERIFYING')) return 'VERIFYING'; if (activity.some((item) => ['EXECUTING','LEASE_ACQUIRED','EXECUTED','SIMULATED'].includes(item.state))) return 'EXECUTING'; if (approvals.length || activity.some((item) => item.state === 'AWAITING_APPROVAL')) return 'WAITING'; if (activity.some((item) => ['FAILED','VERIFICATION_FAILED','PARTIALLY_COMPLETED'].includes(item.state))) return 'ERROR'; if (tasks.some((task) => task.status === 'blocked')) return 'BLOCKED'; if (runs.some((run) => run.status === 'running'&&['CANDIDATE','FALLBACK'].includes(run.routing?.phase??''))) return 'ROUTING'; if (runs.some((run) => run.status === 'running')) return 'THINKING'; if (tasks.some((task) => task.status === 'active' || task.status === 'proposed')) return 'ROUTING'; return 'IDLE'; }
}
