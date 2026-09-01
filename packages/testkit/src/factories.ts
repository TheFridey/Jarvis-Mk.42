/**
 * Test data factories. Deterministic where it matters.
 */
import type {
  Event,
  EventActor,
  PresenceEvidence,
  PrivacyClass,
  Provenance,
  RetentionClass,
} from '@jarvis/contracts';

let seq = 0;
/** Monotonic pseudo-ULID (26 Crockford chars) for tests. */
export function testUlid(): string {
  seq += 1;
  const t = (Date.now() + seq).toString(32).toUpperCase().padStart(10, '0').slice(-10);
  const r = seq.toString(32).toUpperCase().padStart(16, 'A').slice(-16);
  return (t + r).replace(/[^0-9A-HJKMNP-TV-Z]/g, 'A').slice(0, 26).padEnd(26, 'A');
}

export function sysActor(id = 'test'): EventActor {
  return { kind: 'system', id };
}

export function provenance(over: Partial<Provenance> = {}): Provenance {
  return {
    method: 'system',
    producedBy: 'test',
    producedOn: 'test-node',
    producedAt: new Date().toISOString(),
    correlationId: 'test-corr',
    derivedFromUntrusted: false,
    ...over,
  };
}

export function makeEvent(over: Partial<Event> = {}): Event {
  const now = new Date().toISOString();
  return {
    id: testUlid(),
    type: 'jarvis.kernel.test.happened',
    schemaVersion: 1,
    retentionClass: 'OPERATIONAL' as RetentionClass,
    time: now,
    recordedAt: now,
    source: { node: 'test-node', component: 'test' },
    subject: { kind: 'test', id: 'subject-1' },
    actor: sysActor(),
    provenance: provenance(),
    causationId: 'none',
    correlationId: 'test-corr',
    principalId: 'system',
    privacyClass: 'INTERNAL' as PrivacyClass,
    payload: { ok: true },
    ...over,
  };
}

export function presenceEvidence(
  kind: PresenceEvidence['kind'],
  over: Partial<PresenceEvidence> = {},
): PresenceEvidence {
  return {
    kind,
    sourceEventId: testUlid(),
    observedAt: new Date().toISOString(),
    confidence: 0.9,
    nodeId: 'workstation',
    ...over,
  };
}
