/**
 * In-memory EventManager stand-in. Captures emitted events for assertions and
 * validates them with the real Validator so tests still catch schema mistakes.
 */
import { validateEventDraft } from '@jarvis/validation';
import type { Event } from '@jarvis/contracts';
import { testUlid } from './factories.ts';

export interface CapturedEmitInput {
  type: string;
  retentionClass: string;
  privacyClass: string;
  payload: unknown;
  [k: string]: unknown;
}

export class FakeEventManager {
  readonly emitted: Event[] = [];
  private failNext = false;

  failOnce(): void {
    this.failNext = true;
  }

  private build(input: CapturedEmitInput): Event {
    const now = new Date().toISOString();
    return {
      id: testUlid(),
      type: input.type,
      schemaVersion: (input.schemaVersion as number) ?? 1,
      retentionClass: input.retentionClass as Event['retentionClass'],
      time: (input.time as string) ?? now,
      recordedAt: now,
      source: { node: 'test-node', component: 'test' },
      subject: input.subject as Event['subject'],
      actor: input.actor as Event['actor'],
      provenance: {
        method: 'system',
        producedBy: 'test',
        producedOn: 'test-node',
        producedAt: now,
        correlationId: input.correlationId as string,
        derivedFromUntrusted: false,
      },
      causationId: input.causationId as string,
      correlationId: input.correlationId as string,
      principalId: input.principalId as string,
      privacyClass: input.privacyClass as Event['privacyClass'],
      payload: input.payload,
    };
  }

  async emit(input: CapturedEmitInput): Promise<Event> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('injected emit failure');
    }
    const event = this.build(input);
    const result = validateEventDraft(event);
    if (!result.ok) {
      throw new Error(
        `FakeEventManager: invalid event ${event.type}: ${result.issues.map((i) => `${i.path} ${i.message}`).join('; ')}`,
      );
    }
    this.emitted.push(event);
    return event;
  }

  async emitInTx(_tx: unknown, input: CapturedEmitInput): Promise<Event> {
    return this.emit(input);
  }

  byType(type: string): Event[] {
    return this.emitted.filter((e) => e.type === type);
  }

  clear(): void {
    this.emitted.length = 0;
  }
}
