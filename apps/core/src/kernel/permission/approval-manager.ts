import { createHash, randomUUID } from 'node:crypto';
import type { ApprovalRequest, RiskClass } from '@jarvis/contracts';
import type { Sql } from '@jarvis/persistence';

interface ApprovalRow { id: string; invocation_id: string; risk_class: RiskClass; summary: string; simulated_effect: unknown; state: ApprovalRequest['state']; required_authorisations: number; received_authorisations: number; approval_evidence: ApprovalRequest['approvalEvidence'] | null; confirmation_phrase_hash: string | null; requested_at: string; decided_at: string | null; }

export class ApprovalManager {
  constructor(private readonly sql: Sql, private readonly now = () => new Date().toISOString(), private readonly ttlMs = 15 * 60_000) {}
  async request(input: { invocationId: string; riskClass: RiskClass; summary: string; simulatedEffect?: unknown; confirmationPhrase?: string }) {
    const existing = await this.forInvocation(input.invocationId);
    if (existing) return existing;
    const request: ApprovalRequest = { id: randomUUID(), invocationId: input.invocationId, riskClass: input.riskClass, summary: input.summary, state: 'pending', requestedAt: this.now(), requiredAuthorisations: input.riskClass === 'CRITICAL' ? 2 : 1, receivedAuthorisations: 0, ...(input.simulatedEffect !== undefined ? { simulatedEffect: input.simulatedEffect } : {}), ...(input.confirmationPhrase ? { confirmationPhraseHash: this.hash(input.confirmationPhrase) } : {}) };
    await this.sql`insert into agency.approvals (id, invocation_id, risk_class, summary, simulated_effect, state, required_authorisations, received_authorisations, confirmation_phrase_hash, requested_at) values (${request.id}, ${request.invocationId}, ${request.riskClass}, ${request.summary}, ${request.simulatedEffect === undefined ? null : JSON.stringify(request.simulatedEffect)}, ${request.state}, ${request.requiredAuthorisations}, 0, ${request.confirmationPhraseHash ?? null}, ${request.requestedAt})`;
    return request;
  }
  async approve(input: { invocationId: string; operatorId: string; sessionId: string; authTrustLevel: 'trusted' | 'verified'; confirmationPhrase?: string }) {
    const request = await this.forInvocation(input.invocationId);
    if (!request || request.state !== 'pending' || this.expired(request)) return false;
    if (request.riskClass === 'CRITICAL' && (input.authTrustLevel !== 'verified' || !input.confirmationPhrase || this.hash(input.confirmationPhrase) !== request.confirmationPhraseHash)) return false;
    const evidence = { kind: 'operator' as const, by: input.operatorId, at: this.now(), surface: `session:${input.sessionId}` };
    await this.sql`update agency.approvals set state='approved', received_authorisations=${request.requiredAuthorisations}, approval_evidence=${JSON.stringify(evidence)}, decided_at=${this.now()} where id=${request.id} and state='pending'`;
    return true;
  }
  async forInvocation(invocationId: string): Promise<ApprovalRequest | undefined> { const rows = await this.sql<ApprovalRow[]>`select * from agency.approvals where invocation_id=${invocationId} order by requested_at desc limit 1`; if (!rows[0]) return undefined; const row = rows[0]; const request: ApprovalRequest = { id: row.id, invocationId: row.invocation_id, riskClass: row.risk_class, summary: row.summary, state: row.state, requiredAuthorisations: row.required_authorisations, receivedAuthorisations: row.received_authorisations, requestedAt: new Date(row.requested_at).toISOString(), ...(row.simulated_effect !== null ? { simulatedEffect: row.simulated_effect } : {}), ...(row.approval_evidence ? { approvalEvidence: row.approval_evidence } : {}), ...(row.confirmation_phrase_hash ? { confirmationPhraseHash: row.confirmation_phrase_hash } : {}), ...(row.decided_at ? { decidedAt: new Date(row.decided_at).toISOString() } : {}) }; if (request.state === 'pending' && this.expired(request)) { await this.sql`update agency.approvals set state='expired', decided_at=${this.now()} where id=${request.id} and state='pending'`; request.state = 'expired'; request.decidedAt = this.now(); } return request; }
  private expired(request: ApprovalRequest) { return Date.parse(this.now()) >= Date.parse(request.requestedAt) + this.ttlMs; }
  private hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
}
