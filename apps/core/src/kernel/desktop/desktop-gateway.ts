import { timingSafeEqual } from 'node:crypto';
import type { Sql } from '@jarvis/persistence';
import type { Capability, CapabilityInvocationProposal, CognitionResponse } from '@jarvis/contracts';
import type {
  DesktopApproval,
  DesktopApprovalCommand,
  DesktopKernelSnapshot,
  DesktopProposalCommand,
  DesktopProposalResponse,
  DesktopCognitionCommand,
  PresentationState,
  SemanticScene,
} from '@jarvis/scene';
import type { DiagnosticsService } from '../diagnostics/diagnostics-service.ts';
import type { StateManager } from '../state/state-manager.ts';
import type { SessionManager } from '../session/session-manager.ts';
import type { ApprovalManager } from '../permission/approval-manager.ts';
import type { AgencyIngress } from '../agency-ingress/agency-ingress.ts';
import type { CognitionOrchestrator } from '../cognition/cognition-orchestrator.ts';
import type { IdGen } from '../../runtime/ids.ts';

interface InvocationRow {
  invocation_id: string; capability_id: string; action: string; state: DesktopKernelSnapshot['capabilityActivity'][number]['state'];
  origin_actor: { id?: string; kind?: string }; risk_class: DesktopKernelSnapshot['capabilityActivity'][number]['risk'];
  proposal: CapabilityInvocationProposal | null; final_outcome: string | null; updated_at: string; finished_at: string | null;
  manifest: Capability | null;
}

export type DesktopCommandResult<T> = { ok: true; value: T } | { ok: false; code: 'state_version_conflict' | 'approval_rejected'; currentStateVersion: number };

export class DesktopGateway {
  constructor(private readonly deps: { sql: Sql; diagnostics: DiagnosticsService; state: StateManager; sessions: SessionManager; approvals: ApprovalManager; agency: AgencyIngress; cognition: CognitionOrchestrator; ids: IdGen; token: string; nodeId: string }) {}

  authenticate(bearer: string | undefined): boolean {
    if (!this.deps.token || !bearer?.startsWith('Bearer ')) return false;
    const supplied = Buffer.from(bearer.slice(7)); const expected = Buffer.from(this.deps.token);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }

  async snapshot(): Promise<DesktopKernelSnapshot> {
    const [diagnostics, state, sessions, pending, activity, cognitionRows, objectiveRows] = await Promise.all([
      this.deps.diagnostics.report(), this.deps.state.view(), this.deps.sessions.listActive(), this.deps.approvals.listPending(),
      this.deps.sql<InvocationRow[]>`select i.invocation_id, i.capability_id, i.action, i.state, i.origin_actor, i.risk_class, i.proposal, i.final_outcome, coalesce(i.finished_at, i.started_at, i.created_at) as updated_at, i.finished_at, cv.manifest from agency.invocations i left join agency.capability_versions cv on cv.capability_id=i.capability_id and cv.version=i.capability_version order by i.created_at desc limit 30`,
      this.deps.sql<Array<{response:CognitionResponse}>>`select response from cognition.runs where status='completed' and response is not null order by created_at desc limit 20`,
      this.deps.sql<Array<{objective_id:string}>>`select objective_id from projections.objectives where status in ('proposed','active','blocked','paused') order by priority desc,created_at limit 30`,
    ]);
    const principalId = (state.slices.active_principal.value as { principalId: string | null }).principalId;
    const objectiveId = (state.slices.active_objective.value as { objectiveId: string | null }).objectiveId;
    const workspaceId = (state.slices.active_workspace.value as { workspaceId: string | null }).workspaceId;
    const contextId = (state.slices.active_context.value as { contextId: string | null }).contextId;
    const alertIds = (state.slices.active_alerts.value as { alertIds: string[] }).alertIds;
    const byInvocation = new Map(activity.map((row) => [row.invocation_id, row]));
    const approvals: DesktopApproval[] = pending.map((approval) => {
      const row = byInvocation.get(approval.invocationId); const input = row?.proposal?.invocation.input;
      const args = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : { value: input };
      return { ...approval, actor: row?.origin_actor?.id ?? approval.principalId ?? 'unknown', resource: this.resource(args), reason: row?.proposal?.justification ?? approval.summary, scopes: row?.manifest?.requiredScopes ?? [], arguments: args };
    });
    const capabilityActivity = activity.map((row) => ({ invocationId: row.invocation_id, capabilityId: row.capability_id, action: row.action, actor: row.origin_actor?.id ?? 'unknown', risk: row.risk_class, state: row.state, updatedAt: new Date(row.updated_at).toISOString(), ...(row.final_outcome ? { finalOutcome: row.final_outcome } : {}) }));
    const policyDenials = activity.filter((row) => row.state === 'DENIED').map((row) => ({ invocationId: row.invocation_id, capabilityId: row.capability_id, action: row.action, reason: row.final_outcome ?? 'Denied by Kernel policy or permissions', at: new Date(row.updated_at).toISOString() }));
    const scene = this.scene({ stateVersion: state.stateVersion, principalId, objectiveId, workspaceId, contextId, alertIds, diagnostics, activity: capabilityActivity });
    return { schemaVersion: 1, generatedAt: diagnostics.generatedAt, stateVersion: state.stateVersion, principalId, diagnostics, state, sessions, notifications: alertIds, objectives: objectiveRows.map(r=>r.objective_id), cognitionResponses: cognitionRows.map(r=>r.response), capabilityActivity, policyDenials, approvals, scene, selectedProjectId: workspaceId, contextId };
  }

  async cognize(command:DesktopCognitionCommand):Promise<DesktopCommandResult<CognitionResponse>> { const state=await this.deps.state.view(); if(command.expectedStateVersion!==state.stateVersion)return{ok:false,code:'state_version_conflict',currentStateVersion:state.stateVersion}; const principalId=(state.slices.active_principal.value as {principalId:string|null}).principalId;if(!principalId)return{ok:false,code:'approval_rejected',currentStateVersion:state.stateVersion}; const correlationId=this.deps.ids.ulid(); return {ok:true,value:await this.deps.cognition.submit({requestId:command.commandId,principalId,correlationId,input:command.input,agentId:command.agentId??'agents.oracle',task:command.task??'reason',locality:command.locality??'any'})}; }

  async submit(command: DesktopProposalCommand): Promise<DesktopCommandResult<DesktopProposalResponse>> {
    const state = await this.deps.state.view();
    if (command.expectedStateVersion !== state.stateVersion) return { ok: false, code: 'state_version_conflict', currentStateVersion: state.stateVersion };
    const principalId = (state.slices.active_principal.value as { principalId: string | null }).principalId;
    if (!principalId) return { ok: false, code: 'approval_rejected', currentStateVersion: state.stateVersion };
    const result = await this.deps.agency.submit(command.proposal, { principalId, authenticated: true });
    return { ok: true, value: { commandId: command.commandId, stateVersion: (await this.deps.state.view()).stateVersion, result } };
  }

  async decide(command: DesktopApprovalCommand): Promise<DesktopCommandResult<{ accepted: true; outcome: string }>> {
    const state = await this.deps.state.view();
    if (command.expectedStateVersion !== state.stateVersion) return { ok: false, code: 'state_version_conflict', currentStateVersion: state.stateVersion };
    const principalId = (state.slices.active_principal.value as { principalId: string | null }).principalId;
    const request = await this.deps.approvals.forInvocation(command.invocationId);
    if (!principalId || request?.id !== command.approvalId) return { ok: false, code: 'approval_rejected', currentStateVersion: state.stateVersion };
    const input = { invocationId: command.invocationId, operatorId: principalId, sessionId: `desktop:${this.deps.nodeId}`, nonce: command.nonce, version: command.version };
    const accepted = command.decision === 'approve'
      ? await this.deps.approvals.approve({ ...input, authTrustLevel: 'verified', ...(command.confirmationPhrase ? { confirmationPhrase: command.confirmationPhrase } : {}) })
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
    if (input.objectiveId) objects.push({ id: 'objectives', kind: 'objective', title: 'Active objective', semanticRole: 'desired-state', monitorId: 'primary', position: { x: 1180, y: 146 }, size: { width: 410, height: 270 }, zIndex: 2, state: 'expanded', pinned: false, dismissible: true, resourceRefs: [`objective:${input.objectiveId}`], updatedAt: now, data: { eyebrow: 'KERNEL OBJECTIVE', primary: input.objectiveId, progress: 0, next: 'Awaiting objective projection' } });
    if (input.alertIds.length) objects.push({ id: 'alerts', kind: 'alert', title: 'Active alerts', semanticRole: 'attention-required', monitorId: 'primary', position: { x: 165, y: 178 }, size: { width: 405, height: 250 }, zIndex: 3, state: 'expanded', pinned: true, dismissible: false, resourceRefs: input.alertIds.map((id) => `alert:${id}`), updatedAt: now, data: { eyebrow: 'KERNEL ALERTS', primary: `${input.alertIds.length} active`, signal: input.alertIds.join(', ') } });
    return { id: 'primary-workspace', principalId: input.principalId ?? 'unassigned', version: input.stateVersion, presentation, monitors: [{ id: 'primary', label: 'Primary', bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 1, primary: true, connected: true }], objects, ...(input.workspaceId ? { selectedProjectId: input.workspaceId } : {}), updatedAt: now };
  }

  private presentation(mode: DesktopKernelSnapshot['diagnostics']['mode'], _version: number, ok: boolean, activity: DesktopKernelSnapshot['capabilityActivity']): PresentationState {
    if (!ok || mode === 'DEGRADED') return 'DEGRADED'; if (mode === 'GUARDIAN') return 'GUARDIAN';
    if (activity.some((item) => ['EXECUTING', 'VERIFYING', 'ROLLING_BACK'].includes(item.state))) return 'WORKING';
    if (mode === 'ENGAGED') return 'LISTENING'; if (mode === 'FOCUSED') return 'THINKING'; if (mode === 'AUTONOMOUS') return 'WORKING'; return 'DORMANT';
  }
}
