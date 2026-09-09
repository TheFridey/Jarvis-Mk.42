/**
 * RC1.1 EVENT FABRIC AUDIT (external auditor suite).
 *
 * These tests deliberately do NOT reuse the production subject matcher or the
 * production topology validator to decide pass/fail. They read the stream
 * configuration back from a REAL nats-server and re-derive ownership with an
 * independently written NATS subject matcher, so a bug in
 * `stream-topology.ts` cannot mark its own homework.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AckPolicy, connect, type JetStreamManager, type NatsConnection } from 'nats';
import { startEphemeralNats, type EphemeralNats } from '@jarvis/testkit';
import { EventNames, type Event } from '@jarvis/contracts';
import { MemoryDeadLetterSink, MemoryProcessedLedger } from '../src/kernel/event-fabric/stores.ts';
import { NatsEventBus } from '../src/kernel/event-fabric/nats-bus.ts';

let nats: EphemeralNats | undefined;
let url = '';
let bus: NatsEventBus | undefined;
let nc: NatsConnection | undefined;
let jsm: JetStreamManager | undefined;
const transportHealth: boolean[] = [];

/** Independent NATS subject matcher: `*` = exactly one token, `>` = one or more trailing tokens. */
function natsMatches(filter: string, subject: string): boolean {
  const f = filter.split('.');
  const s = subject.split('.');
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '>') return s.length > i;
    if (i >= s.length) return false;
    if (f[i] === '*') continue;
    if (f[i] !== s[i]) return false;
  }
  return f.length === s.length;
}

const makeEvent = (id: string, type: string, retentionClass: Event['retentionClass']): Event => ({
  id,
  type,
  schemaVersion: 1,
  retentionClass,
  time: new Date().toISOString(),
  recordedAt: new Date().toISOString(),
  source: { node: 'audit', component: 'test' },
  subject: { kind: 'test', id },
  actor: { kind: 'system', id: 'audit' },
  provenance: {
    method: 'system',
    producedBy: 'audit',
    producedOn: 'audit',
    producedAt: new Date().toISOString(),
    correlationId: id,
    derivedFromUntrusted: false,
  },
  causationId: 'none',
  correlationId: id,
  principalId: 'system',
  privacyClass: 'INTERNAL',
  payload: {},
});

describe('RC1.1 audit - real JetStream subject ownership', () => {
  beforeAll(async () => {
    nats = await startEphemeralNats('jarvis-audit-nats');
    url = nats.url;
    bus = new NatsEventBus(
      url,
      new MemoryProcessedLedger(),
      new MemoryDeadLetterSink(),
      undefined,
      (healthy) => {
        transportHealth.push(healthy);
      },
    );
    await bus.start();
    nc = await connect({ servers: url });
    jsm = await nc.jetstreamManager();
  }, 180_000);

  afterAll(async () => {
    await nc?.close().catch(() => undefined);
    await bus?.close().catch(() => undefined);
    await nats?.remove();
  }, 60_000);

  it('AUDIT-1: every canonical event is claimed by exactly one live stream', async () => {
    const live: Array<{ name: string; subjects: string[] }> = [];
    for await (const info of jsm!.streams.list()) {
      live.push({ name: info.config.name, subjects: [...info.config.subjects] });
    }
    expect(live.map((s) => s.name).sort()).toEqual(['EPHEMERAL', 'OPERATIONS', 'SECURE']);

    // A catch-all cannot coexist with subset owners: assert no wildcard exists at all.
    const wildcards = live.flatMap((s) =>
      s.subjects.filter((x) => x.includes('*') || x.includes('>')).map((x) => `${s.name}:${x}`),
    );
    expect(wildcards).toEqual([]);

    const table: Array<{ event: string; owners: string[] }> = [];
    for (const event of Object.values(EventNames)) {
      const owners = live
        .filter((s) => s.subjects.some((f) => natsMatches(f, event)))
        .map((s) => s.name);
      table.push({ event, owners });
    }
    const zero = table.filter((r) => r.owners.length === 0);
    const many = table.filter((r) => r.owners.length > 1);
    expect({ zero, many }).toEqual({ zero: [], many: [] });
    expect(table).toHaveLength(Object.values(EventNames).length);

    // Every configured subject must itself be canonical (no orphan subjects).
    const canonical = new Set<string>(Object.values(EventNames));
    const orphans = live.flatMap((s) =>
      s.subjects.filter((x) => !canonical.has(x)).map((x) => `${s.name}:${x}`),
    );
    expect(orphans).toEqual([]);

    console.log(`ROUTING_TABLE_JSON=${JSON.stringify(table)}`);
    console.log(`TOPOLOGY_JSON=${JSON.stringify(live)}`);
  });

  it('AUDIT-1b: the server itself rejects an overlapping catch-all stream', async () => {
    await expect(jsm!.streams.add({ name: 'AUDIT_OVERLAP', subjects: ['jarvis.>'] })).rejects.toThrow();
  });

  it('AUDIT-2: durable consumers deliver, explicitly ack, and dedupe across all three streams', async () => {
    const received: string[] = [];
    const consumer = `audit-all-${Date.now()}`;
    await bus!.subscribe({
      consumer,
      subjects: ['jarvis.>'],
      handler: async (e) => {
        received.push(e.id);
      },
    });

    const samples = [
      makeEvent('01JAUDIT0000000000000000E1', EventNames.VoiceTranscript, 'TRANSIENT'),
      makeEvent('01JAUDIT0000000000000000S1', EventNames.IdentityRevoked, 'SECURITY'),
      makeEvent('01JAUDIT0000000000000000O1', EventNames.ModeChanged, 'OPERATIONAL'),
      makeEvent('01JAUDIT0000000000000000S2', EventNames.SecurityAlertHigh, 'SECURITY'),
      makeEvent('01JAUDIT0000000000000000O2', EventNames.InvocationStarted, 'OPERATIONAL'),
      makeEvent('01JAUDIT0000000000000000E2', EventNames.VisionAirTouch, 'TRANSIENT'),
    ];
    for (const s of samples) await bus!.publish(s);
    for (const s of samples) await bus!.publish(s); // identical msgID -> server-side dedupe

    for (let i = 0; i < 100 && received.length < samples.length; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect([...received].sort()).toEqual(samples.map((s) => s.id).sort());
    await new Promise((r) => setTimeout(r, 750)); // let any duplicate arrive before asserting none does
    expect(received).toHaveLength(samples.length);

    const counts: Record<string, number> = {};
    for (const name of ['EPHEMERAL', 'SECURE', 'OPERATIONS']) {
      counts[name] = (await jsm!.streams.info(name)).state.messages;
    }
    expect(counts).toEqual({ EPHEMERAL: 2, SECURE: 2, OPERATIONS: 2 });

    for (const name of ['EPHEMERAL', 'SECURE', 'OPERATIONS']) {
      const durable = `${consumer}--${name}`.replace(/[^a-zA-Z0-9_-]/g, '_');
      const info = await jsm!.consumers.info(name, durable);
      expect(info.config.ack_policy).toBe(AckPolicy.Explicit);
      expect(info.num_pending).toBe(0);
      expect(info.num_ack_pending).toBe(0);
      expect(info.num_redelivered).toBe(0);
    }
    console.log(`REAL_NATS_COUNTS=${JSON.stringify(counts)}`);
    console.log(`TRANSPORT_HEALTH=${JSON.stringify(transportHealth)}`);
  }, 120_000);
});
