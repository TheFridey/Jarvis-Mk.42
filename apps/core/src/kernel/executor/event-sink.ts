import type { EventActor } from '@jarvis/contracts';
import type { EventManager } from '../event-fabric/event-manager.ts';
import type { ExecutorEventSink } from './executor.ts';

export class KernelExecutorEventSink implements ExecutorEventSink {
  constructor(private readonly events: EventManager) {}
  async emit(type: string, payload: Record<string, unknown>, retention: 'AUDIT' | 'SECURITY', context: { correlationId: string; principalId: string; actor: EventActor }) {
    const event = await this.events.emit({ type, retentionClass: retention, privacyClass: 'SENSITIVE', subject: { kind: 'invocation', id: String(payload.invocationId) }, actor: context.actor, correlationId: context.correlationId, causationId: String(payload.invocationId), principalId: context.principalId, sourceComponent: 'capability-executor', provenance: { producedBy: 'capability-executor' }, payload });
    return event.id;
  }
}
