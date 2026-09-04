import { LEGAL_INVOCATION_TRANSITIONS, type InvocationState } from '@jarvis/contracts';
export function advance(current: InvocationState, next: InvocationState): { ok: true } {
  if (!LEGAL_INVOCATION_TRANSITIONS[current].includes(next)) throw new Error(`illegal invocation transition ${current} -> ${next}`);
  return { ok: true };
}
