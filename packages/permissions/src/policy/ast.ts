import path from 'node:path';
import type { PolicyPredicate, PolicyQuery, RiskClass } from '@jarvis/contracts';

const RISK: RiskClass[] = ['AMBIENT', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
function at(query: PolicyQuery, dotted: string): unknown {
  if (!/^(actor|action|context)(?:\.[A-Za-z0-9_]+)*$/.test(dotted)) return undefined;
  let current: unknown = query;
  for (const part of dotted.split('.')) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
function safePattern(pattern: string): RegExp | undefined {
  if (pattern.length > 256 || /\\[1-9]|\(\?[=!<]/.test(pattern)) return undefined;
  try { return new RegExp(pattern, 'u'); } catch { return undefined; }
}
function compare(left: unknown, right: unknown, op: 'lt' | 'lte' | 'gt' | 'gte'): boolean {
  if (typeof left === 'number' && typeof right === 'number') {
    if (op === 'lt') return left < right; if (op === 'lte') return left <= right; if (op === 'gt') return left > right; return left >= right;
  }
  if (typeof left === 'string' && typeof right === 'string') {
    if (op === 'lt') return left < right; if (op === 'lte') return left <= right; if (op === 'gt') return left > right; return left >= right;
  }
  return false;
}
function inWindow(now: string, tz: string, windows: Array<{ dow: number[]; from: string; to: string }>): boolean {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now));
    const val = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(val('weekday'));
    const hhmm = `${val('hour')}:${val('minute')}`;
    return windows.some((w) => w.dow.includes(dow) && hhmm >= w.from && hhmm <= w.to);
  } catch { return false; }
}
export function evalPredicate(node: PolicyPredicate, query: PolicyQuery): boolean {
  switch (node.op) {
    case 'and': return node.args.every((arg) => evalPredicate(arg, query));
    case 'or': return node.args.some((arg) => evalPredicate(arg, query));
    case 'not': return !evalPredicate(node.arg, query);
    case 'eq': return Object.is(at(query, node.path), node.value);
    case 'ne': return !Object.is(at(query, node.path), node.value);
    case 'lt': case 'lte': case 'gt': case 'gte': return compare(at(query, node.path), node.value, node.op);
    case 'in': return node.values.some((v) => Object.is(v, at(query, node.path)));
    case 'not-in': return !node.values.some((v) => Object.is(v, at(query, node.path)));
    case 'matches': { const re = safePattern(node.pattern); return re ? re.test(String(at(query, node.path) ?? '')) : false; }
    case 'path-under': {
      const candidate = at(query, node.path); if (typeof candidate !== 'string') return false;
      const root = path.resolve(node.prefix); const resolved = path.resolve(candidate);
      return resolved === root || resolved.startsWith(`${root}${path.sep}`);
    }
    case 'time-window': return inWindow(query.context.now, node.tz, node.windows);
    case 'scope-held': return query.actor.heldScopes.includes(node.scope);
    case 'risk-at-least': return RISK.indexOf(query.action.riskClass) >= RISK.indexOf(node.class);
  }
}
