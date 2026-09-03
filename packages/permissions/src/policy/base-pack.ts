import type { PolicyPredicate, PolicyRule, PolicyVerdict } from '@jarvis/contracts';
const rule = (id: string, effect: PolicyVerdict, priority: number, predicate: PolicyPredicate): PolicyRule => ({ id, version: 1, description: id, effect, priority, predicate, enabled: true });
const and = (...args: PolicyPredicate[]): PolicyPredicate => ({ op: 'and', args });
const eq = (path: string, value: unknown): PolicyPredicate => ({ op: 'eq', path, value });
export const BASE_RULE_PACK: PolicyRule[] = [
  rule('base.read.ambient', 'ALLOW', 10, eq('action.riskClass', 'AMBIENT')),
  rule('base.github.read', 'ALLOW', 20, and(eq('action.capabilityId', 'capabilities.github'), { op: 'matches', path: 'action.action', pattern: '^(list|get|read)_' })),
  rule('base.github.branch.create', 'ALLOW', 30, and(eq('action.capabilityId', 'capabilities.github'), eq('action.action', 'create_branch'), { op: 'scope-held', scope: 'github.branch.write' })),
  rule('base.github.merge.protected', 'REQUIRE_APPROVAL', 80, and(eq('action.capabilityId', 'capabilities.github'), eq('action.action', 'merge'), { op: 'matches', path: 'context.resourceRef', pattern: '(?:^|/)(main|master)$' })),
  rule('base.github.force_push', 'REQUIRE_APPROVAL', 80, and(eq('action.capabilityId', 'capabilities.github'), eq('action.action', 'push_force'))),
  rule('base.fs.write.workspace', 'ALLOW', 30, and(eq('action.capabilityId', 'capabilities.filesystem'), eq('action.action', 'write_file'), { op: 'scope-held', scope: 'filesystem.write' })),
  rule('base.fs.write.outside', 'DENY', 100, and(eq('action.capabilityId', 'capabilities.filesystem'), eq('action.action', 'write_outside_workspace'))),
  rule('base.terminal.any', 'REQUIRE_APPROVAL', 70, eq('action.capabilityId', 'capabilities.terminal')),
  rule('base.deploy.staging', 'ALLOW', 30, and(eq('action.action', 'deploy_staging'), { op: 'scope-held', scope: 'deploy.staging' }, eq('context.degradation', 'nominal'))),
  rule('base.deploy.production', 'REQUIRE_APPROVAL', 80, eq('action.action', 'deploy_production')),
  rule('base.db.drop.production', 'DENY', 100, { op: 'matches', path: 'action.action', pattern: '^(drop_|truncate_|delete_database)' }),
  rule('base.comms.external.send', 'REQUIRE_APPROVAL', 70, eq('action.action', 'send_external')),
  rule('base.spend.any', 'REQUIRE_APPROVAL', 70, { op: 'matches', path: 'action.action', pattern: '^(spend|purchase|pay)' }),
  rule('base.spend.financial_transfer', 'DENY', 100, eq('action.action', 'financial_transfer')),
  rule('base.untrusted.cap', 'DENY', 1000, and(eq('context.derivedFromUntrusted', true), { op: 'risk-at-least', class: 'MEDIUM' })),
  rule('base.guardian.lockdown', 'DENY', 900, and(eq('context.jarvisMode', 'GUARDIAN'), { op: 'risk-at-least', class: 'HIGH' })),
];
