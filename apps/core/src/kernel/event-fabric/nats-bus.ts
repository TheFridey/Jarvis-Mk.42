/**
 * NATS JetStream EventBus (ADR-0005). Streams:
 *   EPHEMERAL  -> jarvis.perception.>            (TRANSIENT)
 *   OPERATIONS -> jarvis.>  (catch-all minus below)
 *   SECURE     -> jarvis.kernel.identity.>, .policy.>, .permission.>, agency.capability.>
 *
 * Durable pull consumers, explicit ack, bounded redelivery. On connection loss
 * the bus reports unhealthy; the Kernel keeps writing PostgreSQL + outbox, and
 * the OutboxRelay resumes publishing on reconnect (FAILURE_MODEL.md sec NATS).
 */
import {
  AckPolicy,
  connect,
  RetentionPolicy,
  type ConsumerConfig,
  type JetStreamClient,
  type JetStreamManager,
  type NatsConnection,
} from 'nats';
import type { Event } from '@jarvis/contracts';
import {
  deliverWithGuards,
  subjectMatches,
  type ConsumerOptions,
  type DeadLetterSink,
  type EventBus,
  type ProcessedLedger,
  type Subscription,
} from './bus.ts';

const STREAMS: { name: string; subjects: string[] }[] = [
  { name: 'EPHEMERAL', subjects: ['jarvis.perception.>'] },
  {
    name: 'SECURE',
    subjects: [
      'jarvis.kernel.identity.>',
      'jarvis.kernel.policy.>',
      'jarvis.kernel.permission.>',
      'jarvis.agency.capability.>',
    ],
  },
  { name: 'OPERATIONS', subjects: ['jarvis.>'] }, // declared last; overlap resolved by explicit filter subjects on consumers
];

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class NatsEventBus implements EventBus {
  private nc?: NatsConnection;
  private js?: JetStreamClient;
  private jsm?: JetStreamManager;
  private healthy = false;
  private readonly closers: Array<() => Promise<void>> = [];

  constructor(
    private readonly url: string,
    private readonly processed: ProcessedLedger,
    private readonly deadLetter: DeadLetterSink,
    private readonly onDeadLetter?: (e: Event, err: string) => void,
  ) {}

  async start(): Promise<void> {
    this.nc = await connect({ servers: this.url, reconnect: true, maxReconnectAttempts: -1 });
    this.js = this.nc.jetstream();
    this.jsm = await this.nc.jetstreamManager();

    for (const s of STREAMS) {
      const existing = await this.jsm.streams.info(s.name).catch(() => null);
      if (!existing) {
        await this.jsm.streams.add({
          name: s.name,
          subjects: s.subjects,
          retention: RetentionPolicy.Limits,
          max_age: s.name === 'EPHEMERAL' ? 10 * 60 * 1e9 : 30 * 24 * 3600 * 1e9,
        });
      }
    }

    this.healthy = true;
    void this.watchConnection();
  }

  private async watchConnection(): Promise<void> {
    if (!this.nc) return;
    for await (const status of this.nc.status()) {
      if (status.type === 'disconnect' || status.type === 'error') this.healthy = false;
      if (status.type === 'reconnect') this.healthy = true;
    }
  }

  isHealthy(): boolean {
    return this.healthy && !!this.nc && !this.nc.isClosed();
  }

  async publish(event: Event): Promise<void> {
    if (!this.js) throw new Error('nats bus not started');
    await this.js.publish(event.type, encoder.encode(JSON.stringify(event)), {
      msgID: event.id, // JetStream dedupe on republish
    });
  }

  async subscribe(opts: ConsumerOptions): Promise<Subscription> {
    if (!this.js || !this.jsm) throw new Error('nats bus not started');
    const full: Required<ConsumerOptions> = { maxAttempts: 5, backoffMs: 100, ...opts };

    // A consumer reads from whichever stream carries its subjects. For the
    // Nervous System every kernel consumer wants OPERATIONS + SECURE; we bind
    // one durable consumer per (stream) it needs.
    const streamsForConsumer = STREAMS.filter((s) =>
      full.subjects.some((sub) => s.subjects.some((ss) => overlaps(ss, sub))),
    );

    for (const stream of streamsForConsumer) {
      const durable = `${full.consumer}--${stream.name}`.replace(/[^a-zA-Z0-9_-]/g, '_');
      const cfg: Partial<ConsumerConfig> = {
        durable_name: durable,
        ack_policy: AckPolicy.Explicit,
        max_deliver: full.maxAttempts + 1,
        filter_subjects: full.subjects,
      };
      await this.jsm.consumers.add(stream.name, cfg).catch(async (e: unknown) => {
        // already exists is fine
        if (!(e instanceof Error && /already in use|exists/i.test(e.message))) throw e;
      });
      const consumer = await this.js.consumers.get(stream.name, durable);
      const messages = await consumer.consume();
      const loop = (async () => {
        for await (const m of messages) {
          const event = JSON.parse(decoder.decode(m.data)) as Event;
          try {
            await deliverWithGuards(event, full, {
              processed: this.processed,
              deadLetter: this.deadLetter,
              onDeadLetter: this.onDeadLetter,
            });
            m.ack();
          } catch {
            m.nak();
          }
        }
      })();
      this.closers.push(async () => {
        messages.stop();
        await loop.catch(() => undefined);
      });
    }

    return {
      consumer: full.consumer,
      close: async () => {
        /* consumers are torn down on bus close */
      },
    };
  }

  async close(): Promise<void> {
    for (const c of this.closers) await c().catch(() => undefined);
    await this.nc?.drain().catch(() => undefined);
    await this.nc?.close().catch(() => undefined);
    this.healthy = false;
  }
}

function overlaps(streamSubject: string, consumerSubject: string): boolean {
  return (
    subjectMatches(streamSubject, consumerSubject) ||
    subjectMatches(consumerSubject, streamSubject)
  );
}
