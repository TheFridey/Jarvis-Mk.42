import { createHash, randomUUID } from 'node:crypto';
import type { AdapterContext, Capability, CapabilityInvocationProposal, CredentialHandle, EventActor, InvocationLifecycle, InvocationResult, PolicyDecision } from '@jarvis/contracts';
import { checkResourceConstraints } from '@jarvis/permissions';
import { InvocationStore } from './invocation-store.ts';
import { ResourceLeaseManager } from './lease.ts';
import { VerificationRunner, type AdapterRunner } from './verify-runner.ts';
import { canonicalJson, valueAtPath } from '../../runtime/canonical-json.ts';

export interface ExecutorEventSink { emit(type: string, payload: Record<string, unknown>, retention: 'AUDIT' | 'SECURITY'): Promise<string>; }
export interface ExecutorPermission { authorise(input: { invocationId: string; principalId: string; scopes: string[]; riskClass: string; approvalRequired: boolean }): Promise<{ ok: boolean; approved?: boolean; grantId?: string; grantVersion?: number; authorityToken?: string; resourceConstraints?: Parameters<typeof checkResourceConstraints>[0] }>; freshnessCheck(id: string, version: number): Promise<'ok' | 'stale' | 'revoked' | 'expired'>; }
export interface ExecutorBroker { mint(input: { authorityToken: string; invocationId: string; capabilityId: string; action: string; resourceRef: string; mode: 'dry-run' | 'full'; ttlMs?: number }): Promise<CredentialHandle>; revoke?(handleId: string): Promise<void>; }
export interface ExecutorDeps {
  lookup(id: string, version?: string): Promise<Capability | undefined>;
  validateInput(schema: unknown, input: unknown): boolean;
  evaluate(query: { capability: Capability; action: Capability['actions'][number]; proposal: CapabilityInvocationProposal; origin: EventActor }): PolicyDecision;
  permission: ExecutorPermission; broker: ExecutorBroker; adapter(capability: Capability): AdapterRunner; verification: VerificationRunner; events: ExecutorEventSink;
  store?: InvocationStore; leases?: ResourceLeaseManager; now?: () => string;
}
export class CapabilityExecutor {
  private readonly store: InvocationStore; private readonly leases: ResourceLeaseManager; private readonly now: () => string;
  constructor(private readonly deps: ExecutorDeps) { this.store = deps.store ?? new InvocationStore(); this.leases = deps.leases ?? new ResourceLeaseManager(); this.now = deps.now ?? (() => new Date().toISOString()); }
  async invoke(proposal: CapabilityInvocationProposal, origin: EventActor): Promise<InvocationResult> {
    const prior = this.store.byProposal(proposal.proposalId);
    if (prior) return { invocationId: prior.invocationId, outcome: this.outcome(prior.state), finishedAt: prior.finishedAt ?? this.now() };
    const id = randomUUID(); const inputHash = createHash('sha256').update(canonicalJson(proposal.invocation.input)).digest('hex');
    const capability = await this.deps.lookup(proposal.invocation.capabilityId, proposal.invocation.capabilityVersion);
    const initial: InvocationLifecycle = { invocationId: id, proposalId: proposal.proposalId, capabilityId: proposal.invocation.capabilityId, capabilityVersion: proposal.invocation.capabilityVersion, action: proposal.invocation.action,
      state: 'PROPOSED', correlationId: proposal.correlationId, principalId: origin.onBehalfOf ?? origin.id, originActor: origin, riskClass: 'CRITICAL', inputHash, history: [] };
    this.store.create(initial); await this.event(id, 'proposed', { capabilityId: initial.capabilityId, version: initial.capabilityVersion, action: initial.action, inputHash });
    const action = capability?.actions.find((candidate) => candidate.name === initial.action);
    if (!capability || !action || !this.deps.validateInput(action.inputSchema, proposal.invocation.input)) return this.terminal(id, 'REJECTED', 'rejected', 'invalid capability, version, action, or input', 'SECURITY');
    initial.riskClass = action.riskClass; await this.transition(id, 'VALIDATED', 'validated');
    const policy = this.deps.evaluate({ capability, action, proposal, origin }); await this.transition(id, 'POLICY_CHECKED', 'policy_checked', { verdict: policy.verdict, firedRuleIds: policy.firedRuleIds });
    if (policy.verdict === 'DENY') return this.terminal(id, 'DENIED', 'denied', policy.rationale, 'SECURITY');
    const auth = await this.deps.permission.authorise({ invocationId: id, principalId: initial.principalId, scopes: [...capability.requiredScopes], riskClass: action.riskClass, approvalRequired: policy.verdict === 'REQUIRE_APPROVAL' });
    if (!auth.ok || !auth.grantId || auth.grantVersion === undefined) return this.terminal(id, 'DENIED', 'denied', 'permission or approval denied', 'SECURITY');
    if (!checkResourceConstraints(auth.resourceConstraints ?? [], proposal.invocation.input, action.name).ok) return this.terminal(id, 'DENIED', 'denied', 'resource constraint denied', 'SECURITY');
    if (policy.verdict === 'REQUIRE_APPROVAL' || action.riskClass === 'CRITICAL') {
      await this.transition(id, 'AWAITING_APPROVAL', 'awaiting_approval');
      if (!auth.approved) return { invocationId: id, outcome: 'awaiting_approval', finishedAt: this.now() };
    }
    await this.transition(id, 'APPROVED', 'approved');
    if (await this.deps.permission.freshnessCheck(auth.grantId, auth.grantVersion) !== 'ok') return this.terminal(id, 'ABORTED', 'aborted', 'grant freshness barrier failed', 'SECURITY');
    if (!auth.authorityToken) return this.terminal(id, 'ABORTED', 'aborted', 'authority token unavailable', 'SECURITY');
    const selectedResource = capability.resourceKeySelector ? valueAtPath(proposal.invocation.input, capability.resourceKeySelector) : action.name;
    const resource = `${initial.capabilityId}:${String(selectedResource ?? action.name)}`; if (!await this.leases.acquire(resource, id)) return this.terminal(id, 'ABORTED', 'aborted', 'resource lease unavailable', 'SECURITY');
    let handle: CredentialHandle | undefined;
    try {
      const adapter = this.deps.adapter(capability);
      if (['HIGH', 'CRITICAL'].includes(action.riskClass) && action.simulatable && adapter.simulate) return this.terminal(id, 'ABORTED', 'aborted', 'simulation requires a distinct dry-run authority token', 'SECURITY');
      await this.transition(id, 'EXECUTING', 'started', { grantId: auth.grantId, grantVersion: auth.grantVersion });
      handle = await this.deps.broker.mint({ authorityToken: auth.authorityToken, invocationId: id, capabilityId: capability.id, action: action.name, resourceRef: resource, mode: 'full', ttlMs: action.timeoutMs });
      const ctx = this.context(handle, proposal.invocation.input); const output = await adapter.execute(action.name, ctx, proposal.invocation.input);
      await this.transition(id, 'VERIFYING', 'verifying'); const report = await this.deps.verification.run(proposal.invocation.input, output, action.verificationStrategy);
      if (report.verified) { await this.transition(id, 'COMPLETED', 'verified', { verifyReportRef: createHash('sha256').update(JSON.stringify(report)).digest('hex') }); return { invocationId: id, outcome: 'verified', output, verifyReport: report, finishedAt: this.now() }; }
      if (action.reversible && adapter.rollback) { await this.transition(id, 'ROLLING_BACK', 'rolling_back'); await adapter.rollback(action.name, ctx, proposal.invocation.input); await this.transition(id, 'ROLLED_BACK', 'rolled_back'); return { invocationId: id, outcome: 'rolled_back', verifyReport: report, finishedAt: this.now() }; }
      return this.terminal(id, 'VERIFICATION_FAILED', 'verification_failed', 'world verification failed', 'SECURITY');
    } catch (error) {
      const state = this.store.get(id)?.state;
      const reason = error instanceof Error ? error.message : 'adapter failure';
      if (state === 'VERIFYING' || state === 'ROLLING_BACK') return this.terminal(id, 'VERIFICATION_FAILED', 'verification_failed', reason, 'SECURITY');
      return this.terminal(id, 'FAILED', 'failed', reason, 'AUDIT');
    }
    finally { this.leases.release(resource, id); if (handle && this.deps.broker.revoke) await this.deps.broker.revoke(handle.handleId); }
  }
  private context(credential: CredentialHandle, input: unknown): AdapterContext { return { credential, input, mode: credential.mode, abortSignal: new AbortController().signal, log: () => undefined, http: async () => { throw new Error('http unavailable'); } }; }
  private async event(id: string, name: string, payload: Record<string, unknown> = {}, retention: 'AUDIT' | 'SECURITY' = 'AUDIT') { return this.deps.events.emit(`jarvis.agency.invocation.${name}`, { invocationId: id, ...payload }, retention); }
  private async transition(id: string, state: InvocationLifecycle['state'], name: string, payload: Record<string, unknown> = {}, retention: 'AUDIT' | 'SECURITY' = 'AUDIT') { const eventId = await this.event(id, name, payload, retention); this.store.transition(id, state, this.now(), eventId); }
  private async terminal(id: string, state: 'REJECTED' | 'DENIED' | 'ABORTED' | 'FAILED' | 'VERIFICATION_FAILED', outcome: InvocationResult['outcome'], reason: string, retention: 'AUDIT' | 'SECURITY'): Promise<InvocationResult> { await this.transition(id, state, outcome, { reason }, retention); return { invocationId: id, outcome, finishedAt: this.now() }; }
  private outcome(state: InvocationLifecycle['state']): InvocationResult['outcome'] {
    const map: Partial<Record<InvocationLifecycle['state'], InvocationResult['outcome']>> = { AWAITING_APPROVAL: 'awaiting_approval', COMPLETED: 'verified', REJECTED: 'rejected', DENIED: 'denied', ABORTED: 'aborted', FAILED: 'failed', VERIFICATION_FAILED: 'verification_failed', ROLLED_BACK: 'rolled_back', PARTIALLY_COMPLETED: 'partially_completed' };
    return map[state] ?? 'failed';
  }
}
