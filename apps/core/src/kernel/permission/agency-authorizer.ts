import type { RiskClass } from '@jarvis/contracts';
import type { ExecutorPermission } from '../executor/executor.ts';
import type { ApprovalManager } from './approval-manager.ts';
import type { PgGrantStore } from './grant-store.ts';
import type { PermissionManager } from './permission-manager.ts';

const risks: RiskClass[] = ['AMBIENT', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
export class AgencyAuthorizer implements ExecutorPermission {
  constructor(private readonly grants: PgGrantStore, private readonly permissions: PermissionManager, private readonly approvals: ApprovalManager, private readonly now = () => new Date().toISOString()) {}
  async authorise(input: Parameters<ExecutorPermission['authorise']>[0]) {
    const grant = await this.grants.findActive(input.principalId, input.scopes, this.now());
    if (!grant) return { ok: false as const };
    const needsApproval = input.approvalRequired || input.forceLiveApproval || input.riskClass === 'CRITICAL';
    let approved = !needsApproval;
    let approvalRequestId: string | undefined;
    if (needsApproval) {
      const standing = !input.forceLiveApproval && grant.mayProceedWithoutLiveApproval && risks.indexOf(input.riskClass as RiskClass) <= risks.indexOf(grant.maxRiskWithoutLiveApproval);
      if (standing) approved = true;
      else {
        const request = await this.approvals.request({ invocationId: input.invocationId, principalId: input.principalId, capabilityId: input.capabilityId, capabilityVersion: input.capabilityVersion, action: input.action, inputHash: input.inputHash, riskClass: input.riskClass as RiskClass, summary: input.summary, ...(input.confirmationPhrase ? { confirmationPhrase: input.confirmationPhrase } : {}) });
        approvalRequestId = request.id; approved = request.state === 'approved';
      }
    }
    if (!approved) return { ok: true, approved: false, approvalRequestId, grantId: grant.id, grantVersion: grant.version, resourceConstraints: grant.resourceConstraints };
    const [full, verify, before] = await Promise.all([this.permissions.mint(input.invocationId, grant.id, input.scopes, 'full'), this.permissions.mint(input.invocationId, grant.id, input.scopes, 'dry-run'), this.permissions.mint(input.invocationId, grant.id, input.scopes, 'dry-run')]);
    return { ok: true, approved: true, approvalRequestId, grantId: grant.id, grantVersion: grant.version, authorityToken: full.token, verificationAuthorityToken: verify.token, beforeAuthorityToken: before.token, resourceConstraints: grant.resourceConstraints };
  }
  freshnessCheck(id: string, version: number) { return this.permissions.freshnessCheck(id, version); }
}
