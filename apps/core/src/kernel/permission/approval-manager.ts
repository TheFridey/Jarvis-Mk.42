import { createHash, randomUUID } from 'node:crypto';
import type { ApprovalRequest, RiskClass } from '@jarvis/contracts';
import type { Sql } from '@jarvis/persistence';

interface ApprovalBinding { invocationId: string; principalId: string; capabilityId: string; capabilityVersion: string; action: string; inputHash: string; riskClass: RiskClass; summary: string; simulatedEffect?: unknown; confirmationPhrase?: string; }
interface ApprovalRow { id: string; invocation_id: string; principal_id: string | null; capability_id: string | null; capability_version: string | null; action: string | null; input_hash: string | null; expires_at: string | null; nonce: string | null; version: number; risk_class: RiskClass; summary: string; simulated_effect: unknown; state: ApprovalRequest['state']; required_authorisations: number; received_authorisations: number; approval_evidence: ApprovalRequest['approvalEvidence'] | null; confirmation_phrase_hash: string | null; requested_at: string; decided_at: string | null; }

export class ApprovalManager {
  constructor(private readonly sql: Sql, private readonly now = () => new Date().toISOString(), private readonly ttlMs = 15 * 60_000) {}
  async request(input: ApprovalBinding) {
    const existing = await this.forInvocation(input.invocationId);
    if (existing) {
      if (existing.principalId !== input.principalId || existing.capabilityId !== input.capabilityId || existing.capabilityVersion !== input.capabilityVersion || existing.action !== input.action || existing.inputHash !== input.inputHash || existing.riskClass !== input.riskClass) throw new Error('approval binding mismatch');
      return existing;
    }
    const requestedAt = this.now(); const expiresAt = new Date(Date.parse(requestedAt) + this.ttlMs).toISOString();
    const request: ApprovalRequest = { id: randomUUID(), invocationId: input.invocationId, principalId: input.principalId, capabilityId: input.capabilityId, capabilityVersion: input.capabilityVersion, action: input.action, inputHash: input.inputHash, riskClass: input.riskClass, summary: input.summary, state: 'pending', requestedAt, expiresAt, nonce: randomUUID(), version: 1, requiredAuthorisations: input.riskClass === 'CRITICAL' ? 2 : 1, receivedAuthorisations: 0, ...(input.simulatedEffect !== undefined ? { simulatedEffect: input.simulatedEffect } : {}), ...(input.confirmationPhrase ? { confirmationPhraseHash: this.hash(input.confirmationPhrase) } : {}) };
    await this.sql`insert into agency.approvals (id, invocation_id, principal_id, capability_id, capability_version, action, input_hash, expires_at, nonce, version, risk_class, summary, simulated_effect, state, required_authorisations, received_authorisations, confirmation_phrase_hash, requested_at) values (${request.id}, ${input.invocationId}, ${input.principalId}, ${input.capabilityId}, ${input.capabilityVersion}, ${input.action}, ${input.inputHash}, ${expiresAt}, ${request.nonce!}, 1, ${input.riskClass}, ${input.summary}, ${input.simulatedEffect === undefined ? null : JSON.stringify(input.simulatedEffect)}, ${request.state}, ${request.requiredAuthorisations}, 0, ${request.confirmationPhraseHash ?? null}, ${requestedAt})`;
    return request;
  }
  async approve(input: { invocationId: string; operatorId: string; sessionId: string; authTrustLevel: 'trusted' | 'verified'; confirmationPhrase?: string; nonce: string; version: number }) {
    const request = await this.forInvocation(input.invocationId);
    if (!request || request.state !== 'pending' || this.expired(request) || input.nonce !== request.nonce || input.version !== request.version) return false;
    if (request.riskClass === 'CRITICAL' && (input.authTrustLevel !== 'verified' || !input.confirmationPhrase || this.hash(input.confirmationPhrase) !== request.confirmationPhraseHash)) return false;
    const evidence = { kind: 'operator' as const, by: input.operatorId, at: this.now(), surface: `session:${input.sessionId}` };
    const rows = await this.sql<{ id: string }[]>`update agency.approvals set state='approved', received_authorisations=required_authorisations, approval_evidence=${JSON.stringify(evidence)}, decided_at=${this.now()}, version=version+1 where id=${request.id} and state='pending' and version=${request.version ?? 1} and expires_at>${this.now()} returning id`;
    return rows.length === 1;
  }
  async forInvocation(invocationId: string): Promise<ApprovalRequest | undefined> {
    const rows = await this.sql<ApprovalRow[]>`select * from agency.approvals where invocation_id=${invocationId} order by requested_at desc limit 1`; const row = rows[0]; if (!row) return undefined;
    const request: ApprovalRequest = { id: row.id, invocationId: row.invocation_id, riskClass: row.risk_class, summary: row.summary, state: row.state, requiredAuthorisations: row.required_authorisations, receivedAuthorisations: row.received_authorisations, requestedAt: new Date(row.requested_at).toISOString(), version: row.version, ...(row.principal_id ? { principalId: row.principal_id } : {}), ...(row.capability_id ? { capabilityId: row.capability_id } : {}), ...(row.capability_version ? { capabilityVersion: row.capability_version } : {}), ...(row.action ? { action: row.action } : {}), ...(row.input_hash ? { inputHash: row.input_hash } : {}), ...(row.expires_at ? { expiresAt: new Date(row.expires_at).toISOString() } : {}), ...(row.nonce ? { nonce: row.nonce } : {}), ...(row.simulated_effect !== null ? { simulatedEffect: row.simulated_effect } : {}), ...(row.approval_evidence ? { approvalEvidence: row.approval_evidence } : {}), ...(row.confirmation_phrase_hash ? { confirmationPhraseHash: row.confirmation_phrase_hash } : {}), ...(row.decided_at ? { decidedAt: new Date(row.decided_at).toISOString() } : {}) };
    if (request.state === 'pending' && this.expired(request)) { await this.sql`update agency.approvals set state='expired', decided_at=${this.now()}, version=version+1 where id=${request.id} and state='pending'`; request.state = 'expired'; request.decidedAt = this.now(); request.version = (request.version ?? 1) + 1; }
    return request;
  }
  private expired(request: ApprovalRequest) { return Date.parse(this.now()) >= Date.parse(request.expiresAt ?? new Date(Date.parse(request.requestedAt) + this.ttlMs).toISOString()); }
  private hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
}
