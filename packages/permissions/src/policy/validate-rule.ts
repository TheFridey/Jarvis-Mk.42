import type { PolicyPredicate, PolicyRule } from '@jarvis/contracts';
function nodes(root: PolicyPredicate): PolicyPredicate[] { return root.op === 'and' || root.op === 'or' ? [root, ...root.args.flatMap(nodes)] : root.op === 'not' ? [root, ...nodes(root.arg)] : [root]; }
export function validatePolicyRule(rule: PolicyRule): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const all = nodes(rule.predicate);
  if (all.some((n) => 'path' in n && n.path === 'context.llmRecommendation') && rule.effect !== 'DENY') errors.push('llmRecommendation may only produce DENY');
  if (all.some((n) => 'path' in n && (n.path === 'context.jarvisMode' || n.path === 'context.activeObjectiveGate')) && rule.effect === 'ALLOW') errors.push('mode/objective predicates are restrict-only');
  return errors.length ? { ok: false, errors } : { ok: true };
}
