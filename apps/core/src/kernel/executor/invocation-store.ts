import type { InvocationLifecycle, InvocationState } from '@jarvis/contracts';
import { TERMINAL_INVOCATION_STATES } from '@jarvis/contracts';
import { advance } from './lifecycle.ts';
export class InvocationStore {
  private readonly rows = new Map<string, InvocationLifecycle>();
  private readonly proposals = new Map<string, string>();
  create(row: InvocationLifecycle) { if (this.rows.has(row.invocationId)) throw new Error('duplicate invocation'); if (row.proposalId && this.proposals.has(row.proposalId)) throw new Error('duplicate proposal'); this.rows.set(row.invocationId, structuredClone(row)); if (row.proposalId) this.proposals.set(row.proposalId, row.invocationId); }
  get(id: string) { return this.rows.get(id); }
  byProposal(id: string) { const invocationId = this.proposals.get(id); return invocationId ? this.rows.get(invocationId) : undefined; }
  transition(id: string, state: InvocationState, at: string, eventId: string) { const row = this.rows.get(id); if (!row) throw new Error('invocation not found'); advance(row.state, state); row.state = state; row.history.push({ state, at, eventId }); if ((TERMINAL_INVOCATION_STATES as readonly string[]).includes(state)) row.finishedAt = at; }
  orphaned() { return [...this.rows.values()].filter((r) => ['EXECUTING', 'SIMULATING', 'ROLLING_BACK', 'COMPENSATING'].includes(r.state)); }
}
