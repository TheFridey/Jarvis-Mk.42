import type { Sql } from '@jarvis/persistence';
import type { ExecutorEventSink } from './executor.ts';
import type { InvocationStorePort } from './invocation-store.ts';

export class AgencyRecovery {
  constructor(private readonly sql: Sql, private readonly store: InvocationStorePort, private readonly events: ExecutorEventSink, private readonly now: () => string) {}
  async recoverExpiredLeases() {
    const rows = await this.sql<{ invocation_id: string; recovery_state: unknown }[]>`select i.invocation_id, i.recovery_state from agency.invocations i left join agency.resource_leases l on l.invocation_id=i.invocation_id and l.expires_at>${this.now()} where i.state in ('LEASE_ACQUIRED','EXECUTING','EXECUTED','VERIFYING') and l.invocation_id is null for update of i skip locked`;
    for (const candidate of rows) {
      const invocation = await this.store.get(candidate.invocation_id); if (!invocation) continue;
      const eventId = await this.events.emit('jarvis.agency.invocation.interrupted', { invocationId: invocation.invocationId, reason: 'execution lease expired during kernel outage' }, 'SECURITY', { correlationId: invocation.correlationId, principalId: invocation.principalId, actor: invocation.originActor });
      await this.store.transition(invocation.invocationId, 'INTERRUPTED', this.now(), eventId);
      const next = candidate.recovery_state === null ? 'UNVERIFIED' : 'ROLLBACK_PENDING';
      const nextEvent = await this.events.emit(`jarvis.agency.invocation.${next.toLowerCase()}`, { invocationId: invocation.invocationId, reason: 'restart recovery classification' }, 'SECURITY', { correlationId: invocation.correlationId, principalId: invocation.principalId, actor: invocation.originActor });
      await this.store.transition(invocation.invocationId, next, this.now(), nextEvent);
    }
    return rows.length;
  }
}
