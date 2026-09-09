/**
 * NATS JetStream EventBus (ADR-0005). Streams:
 * Each canonical event subject is owned by exactly one stream. The explicit
 * topology is derived from EventNames; JetStream has no negative subject filter.
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
import { STREAMS, streamForEventType, streamSubjectsForFilter, validateStreamTopology } from './stream-topology.ts';
import {
  deliverWithGuards,
  subjectMatches,
  type ConsumerOptions,
  type DeadLetterSink,
  type EventBus,
  type ProcessedLedger,
  type Subscription,
} from './bus.ts';

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
    private readonly onTransportHealth?: (healthy:boolean, detail:string)=>void|Promise<void>,
  ) {}

  async start(): Promise<void> {
    validateStreamTopology();
    this.nc = await connect({ servers: this.url, reconnect: true, maxReconnectAttempts: -1 });
    this.js = this.nc.jetstream();
    this.jsm = await this.nc.jetstreamManager();

    for (const s of [...STREAMS].sort((a) => a.name === 'OPERATIONS' ? -1 : 1)) {
      const existing = await this.jsm.streams.info(s.name).catch(() => null);
      if (!existing) {
        await this.jsm.streams.add({
          name: s.name,
          subjects: s.subjects,
          retention: RetentionPolicy.Limits,
          max_age: s.name === 'EPHEMERAL' ? 10 * 60 * 1e9 : 30 * 24 * 3600 * 1e9,
        });
      } else if (JSON.stringify([...existing.config.subjects].sort()) !== JSON.stringify([...s.subjects].sort())) {
        await this.jsm.streams.update(s.name, { ...existing.config, subjects: s.subjects });
      }
    }

    this.healthy = true;
    await this.onTransportHealth?.(true,'jetstream connected');
    void this.watchConnection();
  }

  private async watchConnection(): Promise<void> {
    if (!this.nc) return;
    for await (const status of this.nc.status()) {
      if (status.type === 'disconnect' || status.type === 'error'){this.healthy = false;await this.onTransportHealth?.(false,`jetstream ${status.type}`)}
      if (status.type === 'reconnect'){this.healthy = true;await this.onTransportHealth?.(true,'jetstream reconnected')}
    }
  }

  isHealthy(): boolean {
    return this.healthy && !!this.nc && !this.nc.isClosed();
  }

  async publish(event: Event): Promise<void> {
    if (!this.js) throw new Error('nats bus not started');
    streamForEventType(event.type);
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
    const streamsForConsumer = STREAMS.map((stream) => ({stream, filters:streamSubjectsForFilter(stream.name, full.subjects, subjectMatches)})).filter((x) => x.filters.length);

    for (const {stream, filters} of streamsForConsumer) {
      const durable = `${full.consumer}--${stream.name}`.replace(/[^a-zA-Z0-9_-]/g, '_');
      const cfg: Partial<ConsumerConfig> = {
        durable_name: durable,
        ack_policy: AckPolicy.Explicit,
        max_deliver: full.maxAttempts + 1,
        filter_subjects: filters,
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
