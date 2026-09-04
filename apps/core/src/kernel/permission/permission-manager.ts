import type { Grant, RiskClass } from '@jarvis/contracts';
import { mintAuthorityToken } from '@jarvis/permissions';
import type { GrantStore } from './grant-store.ts';
import type { TokenCache } from './token-cache.ts';
export class PermissionManager {
  constructor(private readonly grants: GrantStore, private readonly tokens: TokenCache, private readonly now = () => new Date().toISOString()) {}
  async issueGrant(grant: Grant) { if (grant.version < 1) throw new Error('grant version must be positive'); await this.grants.put(grant); return grant; }
  async revokeGrant(id: string) { const grant = await this.required(id); const next = { ...grant, version: grant.version + 1, revokedAt: this.now() }; await this.grants.put(next); return next; }
  async modifyGrant(id: string, change: Partial<Pick<Grant, 'scopes' | 'resourceConstraints' | 'nodeConstraints' | 'timeWindows' | 'maxRiskWithoutLiveApproval' | 'mayProceedWithoutLiveApproval'>>) { const grant = await this.required(id); const next = { ...grant, ...change, version: grant.version + 1 }; await this.grants.put(next); return next; }
  async freshnessCheck(id: string, version: number): Promise<'ok' | 'stale' | 'revoked' | 'expired'> { const grant = await this.grants.get(id); if (!grant || grant.version !== version) return 'stale'; if (grant.revokedAt) return 'revoked'; if (grant.expiresAt && Date.parse(grant.expiresAt) <= Date.parse(this.now())) return 'expired'; return 'ok'; }
  async mint(invocationId: string, grantId: string, scopes: string[], mode: 'dry-run' | 'full') { const grant = await this.required(grantId); const token = mintAuthorityToken({ invocationId, grantId, grantVersion: grant.version, principalId: grant.principalId, scopes, mode, now: this.now() }); await this.tokens.put(token); return token; }
  requiredAuthorisations(risk: RiskClass) { return risk === 'CRITICAL' ? 2 : 1; }
  private async required(id: string) { const grant = await this.grants.get(id); if (!grant) throw new Error('grant not found'); return grant; }
}
