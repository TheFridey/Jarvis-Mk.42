import type { InvocationLifecycle, InvocationState } from '@jarvis/contracts';
import { TERMINAL_INVOCATION_STATES } from '@jarvis/contracts';
import { advance } from './lifecycle.ts';
export class InvocationStore {
  private readonly rows = new Map<string, InvocationLifecycle>();
  create(row: InvocationLifecycle) { if (this.rows.has(row.invocationId)) throw new Error('duplicate invocation'); this.rows.set(row.invocationId, structuredClone(row)); }
  get(id: string) { return this.rows.get(id); }
  transition(id: string, state: InvocationState, at: string, eventId: string) { const row = this.rows.get(id); if (!row) throw new Error('invocation not found'); advance(row.state, state); row.state = state; row.history.push({ state, at, eventId }); if ((TERMINAL_INVOCATION_STATES as readonly string[]).includes(state)) row.finishedAt = at; }
  orphaned() { return [...this.rows.values()].filter((r) => ['EXECUTING', 'SIMULATING', 'ROLLING_BACK', 'COMPENSATING'].includes(r.state)); }
}
