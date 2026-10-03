import { createHash, randomUUID } from 'node:crypto';
import type { AdapterContext, Capability, CapabilityInvocationProposal, CredentialHandle, EventActor, InvocationLifecycle, InvocationResult, PolicyDecision } from '@jarvis/contracts';
import { checkResourceConstraints } from '@jarvis/permissions';
import { InvocationStore, type InvocationStorePort } from './invocation-store.ts';
import { ResourceLeaseManager, type ResourceLeasePort } from './lease.ts';
import { VerificationRunner, type AdapterRunner } from './verify-runner.ts';
import { canonicalJson, valueAtPath } from '../../runtime/canonical-json.ts';
import { withSpan, currentTraceId } from '@jarvis/telemetry';

export interface ExecutorEventSink { emit(type: string, payload: Record<string, unknown>, retention: 'AUDIT' | 'SECURITY', context: { correlationId: string; principalId: string; actor: EventActor }): Promise<string>; }
export interface ExecutorPermission { authorise(input: { invocationId: string; principalId: string; capabilityId: string; capabilityVersion: string; action: string; inputHash: string; scopes: string[]; riskClass: string; approvalRequired: boolean; forceLiveApproval?:boolean; summary: string; confirmationPhrase?: string }): Promise<{ ok: boolean; approved?: boolean; approvalRequestId?: string; grantId?: string; grantVersion?: number; authorityToken?: string; verificationAuthorityToken?: string; beforeAuthorityToken?: string; resourceConstraints?: Parameters<typeof checkResourceConstraints>[0] }>; freshnessCheck(id: string, version: number): Promise<'ok' | 'stale' | 'revoked' | 'expired'>; }
export interface ExecutorBroker { mint(input: { authorityToken: string; invocationId: string; capabilityId: string; action: string; resourceRef: string; mode: 'dry-run' | 'full'; ttlMs?: number; kind?: CredentialHandle['kind'] }): Promise<CredentialHandle>; revoke?(handleId: string): Promise<void>; }
export interface ExecutorDeps {
  lookup(id: string, version?: string): Promise<Capability | undefined>;
  validateInput(schema: unknown, input: unknown): boolean;
  evaluate(query: { capability: Capability; action: Capability['actions'][number]; proposal: CapabilityInvocationProposal; origin: EventActor }): PolicyDecision | Promise<PolicyDecision>;
  permission: ExecutorPermission; broker: ExecutorBroker; adapter(capability: Capability): AdapterRunner; verification: VerificationRunner; events: ExecutorEventSink;
  store?: InvocationStorePort; leases?: ResourceLeasePort; now?: () => string;
}
export class CapabilityExecutor {
  private readonly store: InvocationStorePort; private readonly leases: ResourceLeasePort; private readonly now: () => string;
  constructor(private readonly deps: ExecutorDeps) { this.store = deps.store ?? new InvocationStore(); this.leases = deps.leases ?? new ResourceLeaseManager(); this.now = deps.now ?? (() => new Date().toISOString()); }
  async invoke(proposal: CapabilityInvocationProposal, origin: EventActor, options?: { approvalResume?: boolean }): Promise<InvocationResult> { return withSpan('agency.executor.invoke', { 'jarvis.correlation_id': proposal.correlationId, 'jarvis.capability.id': proposal.invocation.capabilityId, 'jarvis.capability.action': proposal.invocation.action }, () => this.invokeInner(proposal, origin, options)); }
  private async invokeInner(proposal: CapabilityInvocationProposal, origin: EventActor, options?: { approvalResume?: boolean }): Promise<InvocationResult> {
    const prior = await this.store.byProposal(proposal.proposalId);
    if (prior) {
      if (options?.approvalResume === false) {
        const hash = createHash('sha256').update(canonicalJson(proposal.invocation.input)).digest('hex');
        if (prior.principalId !== (origin.onBehalfOf ?? origin.id) || prior.capabilityId !== proposal.invocation.capabilityId || prior.capabilityVersion !== proposal.invocation.capabilityVersion || prior.action !== proposal.invocation.action || prior.inputHash !== hash || prior.correlationId !== proposal.correlationId) throw new Error('duplicate proposal is bound to different authority or input');
        return { invocationId:prior.invocationId,outcome:this.outcome(prior.state),finishedAt:prior.finishedAt??this.now() };
      }
      if (prior.state === 'AWAITING_APPROVAL' && prior.principalId === (origin.onBehalfOf ?? origin.id)) return this.resumeAwaitingApproval(prior, proposal, origin);
      return { invocationId: prior.invocationId, outcome: this.outcome(prior.state), finishedAt: prior.finishedAt ?? this.now() };
    }
    const id = randomUUID(); const inputHash = createHash('sha256').update(canonicalJson(proposal.invocation.input)).digest('hex');
    const capability = await this.deps.lookup(proposal.invocation.capabilityId, proposal.invocation.capabilityVersion);
    const activeTraceId=currentTraceId();
    const initial: InvocationLifecycle = { invocationId: id, proposalId: proposal.proposalId, capabilityId: proposal.invocation.capabilityId, capabilityVersion: proposal.invocation.capabilityVersion, action: proposal.invocation.action,
      state: 'PROPOSED', correlationId: proposal.correlationId, causationId: proposal.provenance.sourceRefs?.[0] ?? proposal.proposalId, ...(activeTraceId?{traceId:activeTraceId}:{}), principalId: origin.onBehalfOf ?? origin.id, originActor: origin, riskClass: 'CRITICAL', inputHash, proposal, attemptCount: 0, history: [] };
    await this.store.create(initial); await this.event(id, 'proposed', { capabilityId: initial.capabilityId, version: initial.capabilityVersion, action: initial.action, inputHash });
    const action = capability?.actions.find((candidate) => candidate.name === initial.action);
    if (!capability || !action || !this.deps.validateInput(action.inputSchema, proposal.invocation.input)) return this.terminal(id, 'REJECTED', 'rejected', 'invalid capability, version, action, or input', 'SECURITY');
    initial.riskClass = action.riskClass; await this.store.patch(id, { riskClass: action.riskClass }); await this.transition(id, 'VALIDATED', 'validated');
    let policy: PolicyDecision; try { policy = await withSpan('agency.policy', {'jarvis.correlation_id':proposal.correlationId}, async()=>this.deps.evaluate({ capability, action, proposal, origin })); } catch { return this.terminal(id, 'DENIED', 'denied', 'policy unavailable', 'SECURITY'); } await this.store.patch(id, { policyDecision: policy }); await this.transition(id, 'POLICY_CHECKED', 'policy_checked', { verdict: policy.verdict, firedRuleIds: policy.firedRuleIds });
    if (policy.verdict === 'DENY') return this.terminal(id, 'DENIED', 'denied', policy.rationale, 'SECURITY');
    let auth: Awaited<ReturnType<ExecutorPermission['authorise']>>; try { auth = await withSpan('agency.permission', {'jarvis.correlation_id':proposal.correlationId}, async()=>this.deps.permission.authorise({ invocationId: id, principalId: initial.principalId, capabilityId: capability.id, capabilityVersion: capability.version, action: action.name, inputHash, scopes: [...(action.requiredScopes ?? capability.requiredScopes)], riskClass: action.riskClass, approvalRequired: policy.verdict === 'REQUIRE_APPROVAL'||action.approvalPolicy==='always',forceLiveApproval:action.approvalPolicy==='always', summary: proposal.justification, ...(action.confirmationPhrase ? { confirmationPhrase: action.confirmationPhrase } : {}) })); } catch { return this.terminal(id, 'DENIED', 'denied', 'permission state unavailable', 'SECURITY'); }
    if (!auth.ok || !auth.grantId || auth.grantVersion === undefined) return this.terminal(id, 'DENIED', 'denied', 'permission or approval denied', 'SECURITY');
    await this.store.patch(id, { permissionDecision: { granted: true, grantId: auth.grantId, grantVersion: auth.grantVersion, approved: auth.approved ?? false } });
    await this.store.patch(id, { grantId: auth.grantId, grantVersion: auth.grantVersion, ...(auth.approvalRequestId ? { approvalRequestId: auth.approvalRequestId } : {}) });
    if (!checkResourceConstraints(auth.resourceConstraints ?? [], proposal.invocation.input, action.name).ok) return this.terminal(id, 'DENIED', 'denied', 'resource constraint denied', 'SECURITY');
    if (policy.verdict === 'REQUIRE_APPROVAL' || action.riskClass === 'CRITICAL'||action.approvalPolicy==='always') {
      await this.transition(id, 'AWAITING_APPROVAL', 'awaiting_approval', { approvalRequestId: auth.approvalRequestId ?? 'unavailable' });
      if (!auth.approved) return { invocationId: id, outcome: 'awaiting_approval', finishedAt: this.now() };
    }
    await this.transition(id, 'APPROVED', 'approved', { approvalRequestId: auth.approvalRequestId ?? 'policy-allow' });
    return this.executeApproved(id, initial, proposal, capability, action, auth);
  }
  private async resumeAwaitingApproval(initial: InvocationLifecycle, proposal: CapabilityInvocationProposal, origin: EventActor): Promise<InvocationResult> {
    const id = initial.invocationId;
    const resumedInputHash = createHash('sha256').update(canonicalJson(proposal.invocation.input)).digest('hex');
    if (resumedInputHash !== initial.inputHash) return this.terminal(id, 'DENIED', 'denied', 'approved invocation arguments changed', 'SECURITY');
    const capability = await this.deps.lookup(initial.capabilityId, initial.capabilityVersion);
    const action = capability?.actions.find((candidate) => candidate.name === initial.action);
    if (!capability || !action || !this.deps.validateInput(action.inputSchema, proposal.invocation.input)) return this.terminal(id, 'DENIED', 'denied', 'approval resume validation failed', 'SECURITY');
    let policy: PolicyDecision;
    try { policy = await withSpan('agency.policy', {'jarvis.correlation_id':proposal.correlationId}, async()=>this.deps.evaluate({ capability, action, proposal, origin })); } catch { return this.terminal(id, 'DENIED', 'denied', 'policy unavailable during approval resume', 'SECURITY'); }
    if (policy.verdict === 'DENY') return this.terminal(id, 'DENIED', 'denied', policy.rationale, 'SECURITY');
    let auth: Awaited<ReturnType<ExecutorPermission['authorise']>>;
    try { auth = await withSpan('agency.permission', {'jarvis.correlation_id':proposal.correlationId}, async()=>this.deps.permission.authorise({ invocationId: id, principalId: initial.principalId, capabilityId: capability.id, capabilityVersion: capability.version, action: action.name, inputHash: initial.inputHash, scopes: [...(action.requiredScopes ?? capability.requiredScopes)], riskClass: action.riskClass, approvalRequired: true, forceLiveApproval:action.approvalPolicy==='always', summary: proposal.justification, ...(action.confirmationPhrase ? { confirmationPhrase: action.confirmationPhrase } : {}) })); } catch { return this.terminal(id, 'DENIED', 'denied', 'permission state unavailable during approval resume', 'SECURITY'); }
    if (!auth.ok || !auth.approved || !auth.grantId || auth.grantVersion === undefined) return this.terminal(id, 'DENIED', 'denied', 'approval missing, denied, or expired', 'SECURITY');
    if (!checkResourceConstraints(auth.resourceConstraints ?? [], proposal.invocation.input, action.name).ok) return this.terminal(id, 'DENIED', 'denied', 'resource constraint denied', 'SECURITY');
    await this.store.patch(id, { grantId: auth.grantId, grantVersion: auth.grantVersion, ...(auth.approvalRequestId ? { approvalRequestId: auth.approvalRequestId } : {}) });
    await this.transition(id, 'APPROVED', 'approved', { approvalRequestId: auth.approvalRequestId ?? 'unavailable' });
    return this.executeApproved(id, initial, proposal, capability, action, auth);
  }
  private async executeApproved(id: string, initial: InvocationLifecycle, proposal: CapabilityInvocationProposal, capability: Capability, action: Capability['actions'][number], auth: Awaited<ReturnType<ExecutorPermission['authorise']>>): Promise<InvocationResult> {
    const assurance=action.verificationAssurance??(action.verificationStrategy.kind==='hash-match'||action.verificationStrategy.kind==='event-await'?'INDEPENDENT':action.verificationStrategy.kind==='state-echo'?'ADAPTER_SELF_REPORT':'SAME_PROVIDER_READBACK');
    if (['HIGH','CRITICAL'].includes(action.riskClass) && assurance === 'ADAPTER_SELF_REPORT') return this.terminal(id, 'ABORTED', 'aborted', 'high-risk action requires non-self-report verification', 'SECURITY');
    if (!auth.grantId || auth.grantVersion === undefined) return this.terminal(id, 'ABORTED', 'aborted', 'grant authority unavailable', 'SECURITY');
    if (await this.deps.permission.freshnessCheck(auth.grantId, auth.grantVersion) !== 'ok') return this.terminal(id, 'ABORTED', 'aborted', 'grant freshness barrier failed', 'SECURITY');
    if (!auth.authorityToken || !auth.verificationAuthorityToken) return this.terminal(id, 'ABORTED', 'aborted', 'authority token unavailable', 'SECURITY');
    const selectedResource = capability.resourceKeySelector ? valueAtPath(proposal.invocation.input, capability.resourceKeySelector) : action.name;
    const resource = `${initial.capabilityId}:${String(selectedResource ?? action.name)}`; if (!await this.leases.acquire(resource, id, action.timeoutMs)) return this.terminal(id, 'ABORTED', 'aborted', 'resource lease unavailable', 'SECURITY');
    await this.store.patch(id, { resourceKey: resource });
    await this.event(id, 'lease_acquired', { resource });
    let handle: CredentialHandle | undefined;
    let verifyHandle: CredentialHandle | undefined;
    let beforeHandle: CredentialHandle | undefined;
    try {
      const adapter = this.deps.adapter(capability);
      if (['HIGH', 'CRITICAL'].includes(action.riskClass) && action.simulatable && adapter.simulate) return this.terminal(id, 'ABORTED', 'aborted', 'simulation requires a distinct dry-run authority token', 'SECURITY');
      let before: unknown;
      try {
        if (action.reversible) {
          if (!auth.beforeAuthorityToken) return this.terminal(id, 'ABORTED', 'aborted', 'pre-state authority token unavailable', 'SECURITY');
          beforeHandle = await this.deps.broker.mint({ authorityToken: auth.beforeAuthorityToken, invocationId: id, capabilityId: capability.id, action: action.verify, resourceRef: resource, mode: 'dry-run', ttlMs: action.timeoutMs, kind: capability.credentialKind ?? 'wrapped-static' });
          before = await this.deps.verification.capture(proposal.invocation.input, action.verificationStrategy, { capability, handle: beforeHandle });
          await this.store.patch(id, { recoveryState: before, beforeStateRef: createHash('sha256').update(canonicalJson(before)).digest('hex') });
        }
        handle = await this.deps.broker.mint({ authorityToken: auth.authorityToken, invocationId: id, capabilityId: capability.id, action: action.name, resourceRef: resource, mode: 'full', ttlMs: action.timeoutMs, kind: capability.credentialKind ?? 'wrapped-static' });
        verifyHandle = await this.deps.broker.mint({ authorityToken: auth.verificationAuthorityToken, invocationId: id, capabilityId: capability.id, action: action.verify, resourceRef: resource, mode: 'dry-run', ttlMs: action.timeoutMs, kind: capability.credentialKind ?? 'wrapped-static' });
        await this.store.patch(id, { credentialLeaseRef: handle.handleId });
      } catch (error) { const detail = error instanceof Error ? error.message : 'unknown broker failure'; return this.terminal(id, 'DENIED', 'denied', `credential lease unavailable: ${detail}`, 'SECURITY'); }
      await this.transition(id, 'EXECUTING', 'started', { grantId: auth.grantId, grantVersion: auth.grantVersion });
      const ctx = this.context(handle, proposal.invocation.input); const output = await withSpan('agency.adapter', {'jarvis.correlation_id':proposal.correlationId}, ()=>adapter.execute(action.name, ctx, proposal.invocation.input));
      const verificationHandle = verifyHandle;
      await this.transition(id, 'VERIFYING', 'verifying'); const report = await withSpan('agency.verification', {'jarvis.correlation_id':proposal.correlationId}, ()=>this.deps.verification.run(proposal.invocation.input, output, action.verificationStrategy, { capability, handle: verificationHandle })); await this.store.patch(id, { verificationMetadata: report });
      if (report.verified) { await this.transition(id, 'COMPLETED', 'verified', { verifyReportRef: createHash('sha256').update(JSON.stringify(report)).digest('hex') }); return { invocationId: id, outcome: 'verified', output, verifyReport: report, finishedAt: this.now() }; }
      if (action.reversible && adapter.rollback) { await this.transition(id, 'ROLLING_BACK', 'rolling_back'); await adapter.rollback(action.name, ctx, proposal.invocation.input, before); const undone = await this.deps.verification.rollbackMatches(proposal.invocation.input, action.verificationStrategy, before, { capability, handle: verifyHandle }); await this.store.patch(id, { rollbackMetadata: { undone } }); if (undone) { await this.transition(id, 'ROLLED_BACK', 'rolled_back', { rollbackReportRef: createHash('sha256').update(canonicalJson({ undone: true })).digest('hex') }); return { invocationId: id, outcome: 'rolled_back', verifyReport: report, finishedAt: this.now() }; } await this.transition(id, 'VERIFICATION_FAILED', 'verification_failed', { verifyReportRef: createHash('sha256').update(canonicalJson({ rollback: 'failed' })).digest('hex') }, 'SECURITY'); return { invocationId: id, outcome: 'verification_failed', verifyReport: report, finishedAt: this.now() }; }
      await this.transition(id, 'VERIFICATION_FAILED', 'verification_failed', { verifyReportRef: createHash('sha256').update(canonicalJson(report)).digest('hex') }, 'SECURITY');
      return { invocationId: id, outcome: 'verification_failed', verifyReport: report, finishedAt: this.now() };
    } catch (error) {
      const state = (await this.store.get(id))?.state;
      const reason = error instanceof Error ? error.message : 'adapter failure';
      if (state === 'VERIFYING' || state === 'ROLLING_BACK') { await this.transition(id, 'VERIFICATION_FAILED', 'verification_failed', { verifyReportRef: createHash('sha256').update(reason).digest('hex') }, 'SECURITY'); return { invocationId: id, outcome: 'verification_failed', finishedAt: this.now() }; }
      return this.terminal(id, 'FAILED', 'failed', reason, 'AUDIT');
    }
    finally { await this.leases.release(resource, id); if (this.deps.broker.revoke) for (const credential of [handle, verifyHandle, beforeHandle]) if (credential) await this.deps.broker.revoke(credential.handleId); }
  }
  private context(credential: CredentialHandle, input: unknown): AdapterContext { return { credential, input, mode: credential.mode, abortSignal: new AbortController().signal, log: () => undefined, http: async () => { throw new Error('http unavailable'); } }; }
  private async event(id: string, name: string, payload: Record<string, unknown> = {}, retention: 'AUDIT' | 'SECURITY' = 'AUDIT') { const row = await this.store.get(id); if (!row) throw new Error('invocation not found'); return this.deps.events.emit(`jarvis.agency.invocation.${name}`, { invocationId: id, ...payload }, retention, { correlationId: row.correlationId, principalId: row.principalId, actor: row.originActor }); }
  private async transition(id: string, state: InvocationLifecycle['state'], name: string, payload: Record<string, unknown> = {}, retention: 'AUDIT' | 'SECURITY' = 'AUDIT') { const eventId = await this.event(id, name, payload, retention); await this.store.transition(id, state, this.now(), eventId); }
  private async terminal(id: string, state: 'REJECTED' | 'DENIED' | 'ABORTED' | 'FAILED' | 'VERIFICATION_FAILED', outcome: InvocationResult['outcome'], reason: string, retention: 'AUDIT' | 'SECURITY'): Promise<InvocationResult> { await this.transition(id, state, outcome, { reason }, retention); return { invocationId: id, outcome, finishedAt: this.now() }; }
  private outcome(state: InvocationLifecycle['state']): InvocationResult['outcome'] {
    const map: Partial<Record<InvocationLifecycle['state'], InvocationResult['outcome']>> = { AWAITING_APPROVAL: 'awaiting_approval', COMPLETED: 'verified', REJECTED: 'rejected', DENIED: 'denied', ABORTED: 'aborted', FAILED: 'failed', VERIFICATION_FAILED: 'verification_failed', ROLLED_BACK: 'rolled_back', PARTIALLY_COMPLETED: 'partially_completed' };
    return map[state] ?? 'failed';
  }
}
