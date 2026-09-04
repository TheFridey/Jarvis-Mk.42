import type { PolicyDecision, PolicyQuery, PolicyRule, PolicyVerdict } from '@jarvis/contracts';
import { evalPredicate } from './ast.ts';
const rank: Record<PolicyVerdict, number> = { DENY: 3, REQUIRE_APPROVAL: 2, ALLOW: 1 };
export function evaluatePolicy(query: PolicyQuery, rules: PolicyRule[]): PolicyDecision {
  if (query.context.derivedFromUntrusted && ['MEDIUM', 'HIGH', 'CRITICAL'].includes(query.action.riskClass)) return decision('DENY', ['hardcap.untrusted']);
  if (query.action.requiredScopes.some((scope) => !query.actor.heldScopes.includes(scope))) return decision('DENY', ['hardcap.missing_scope']);
  if (query.context.jarvisMode === 'GUARDIAN' && query.action.riskClass === 'CRITICAL') return decision('DENY', ['hardcap.guardian_critical']);
  const matches = rules.filter((rule) => rule.enabled && evalPredicate(rule.predicate, query))
    .sort((a, b) => b.priority - a.priority || rank[b.effect] - rank[a.effect] || a.id.localeCompare(b.id));
  const deny = matches.find((rule) => rule.effect === 'DENY');
  const selected = deny ?? matches[0];
  if (selected) return decision(selected.effect, matches.map((rule) => rule.id));
  return decision(query.action.riskClass === 'AMBIENT' ? 'ALLOW' : query.action.riskClass === 'LOW' ? 'REQUIRE_APPROVAL' : 'DENY', ['default.fail_closed']);
}
function decision(verdict: PolicyVerdict, ids: string[]): PolicyDecision { return { verdict, firedRuleIds: ids, rationale: `${verdict}: ${ids.join(',')}` }; }
