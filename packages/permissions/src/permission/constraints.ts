import path from 'node:path';
import type { ResourceConstraint } from '@jarvis/contracts';
export function checkResourceConstraints(constraints: ResourceConstraint[], input: unknown, _action: string): { ok: true } | { ok: false; failed: ResourceConstraint } {
  const data = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  for (const constraint of constraints) {
    let ok = false;
    switch (constraint.kind) {
      case 'path-prefix': { const candidate = typeof data.path === 'string' ? path.resolve(data.path) : ''; const root = path.resolve(constraint.value); ok = candidate === root || candidate.startsWith(`${root}${path.sep}`); break; }
      case 'repo-allow': ok = typeof data.repo === 'string' && constraint.values.includes(data.repo); break;
      case 'domain-allow': { try { ok = typeof data.url === 'string' && constraint.values.includes(new URL(data.url).hostname); } catch { ok = false; } break; }
      case 'command-allow': ok = Array.isArray(data.argv) && typeof data.argv[0] === 'string' && constraint.values.includes(data.argv[0]); break;
      case 'container-image-allow': ok = typeof data.image === 'string' && constraint.values.includes(data.image); break;
      case 'max-amount': ok = data.currency === constraint.currency && typeof data.amount === 'number' && data.amount <= constraint.value; break;
    }
    if (!ok) return { ok: false, failed: constraint };
  }
  return { ok: true };
}
