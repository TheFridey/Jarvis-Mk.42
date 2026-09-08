import { describe, expect, it } from 'vitest';
import type { AtlasObservation } from '@jarvis/contracts';
import { FakeClock } from '../../runtime/clock.ts';
import { ObservationPromoter } from './promotion.ts';
import type { AtlasStore } from './stores.ts';

const at = '2026-09-01T12:00:00.000Z';
const obs = (over: Partial<AtlasObservation>): AtlasObservation => ({
  id: over.id ?? 'O1',
  eventId: 'EV1',
  kind: 'principal-operator/at_workstation',
  summary: 'true',
  source: 'vision-gateway',
  node: 'local-server',
  observedAt: at,
  confidence: 0.8,
  expiresAt: '2026-09-02T00:00:00.000Z',
  principalId: 'principal-operator',
  ...over,
});

function fakeStore(observations: AtlasObservation[]): AtlasStore {
  return {
    async distinctUnpromotedKinds() {
      return [...new Set(observations.map((o) => o.kind))];
    },
    async unpromotedObservations(_p: string, kind: string) {
      return observations.filter((o) => o.kind === kind);
    },
  } as unknown as AtlasStore;
}

describe('ObservationPromoter', () => {
  const clock = new FakeClock(Date.parse('2026-09-01T13:00:00.000Z'));

  it('proposes a fact when corroboration and mean confidence clear the floor', async () => {
    const p = new ObservationPromoter({ store: fakeStore([
      obs({ id: 'O1', confidence: 0.8 }),
      obs({ id: 'O2', confidence: 0.7 }),
      obs({ id: 'O3', confidence: 0.9 }),
    ]), clock });
    const [proposal] = await p.evaluate(['principal-operator']);
    expect(proposal).toMatchObject({
      subjectRef: 'principal-operator',
      attribute: 'at_workstation',
      value: 'true',
      observationIds: ['O1', 'O2', 'O3'],
    });
    expect(proposal!.confidence).toBeGreaterThan(0.8);
  });

  it('does not promote below the corroboration threshold', async () => {
    const p = new ObservationPromoter({ store: fakeStore([obs({ id: 'O1' })]), clock });
    expect(await p.evaluate(['principal-operator'])).toEqual([]);
  });

  it('does not promote when observations disagree on the value', async () => {
    const p = new ObservationPromoter({ store: fakeStore([
      obs({ id: 'O1', summary: 'true' }),
      obs({ id: 'O2', summary: 'false' }),
      obs({ id: 'O3', summary: 'maybe' }),
    ]), clock });
    expect(await p.evaluate(['principal-operator'])).toEqual([]);
  });

  it('does not promote below the mean-confidence floor', async () => {
    const p = new ObservationPromoter({ store: fakeStore([
      obs({ id: 'O1', confidence: 0.4 }),
      obs({ id: 'O2', confidence: 0.5 }),
    ]), clock });
    expect(await p.evaluate(['principal-operator'])).toEqual([]);
  });

  it('ignores observation kinds without a subject/attribute shape', async () => {
    const p = new ObservationPromoter({ store: fakeStore([
      obs({ id: 'O1', kind: 'hand_detected' }),
      obs({ id: 'O2', kind: 'hand_detected' }),
    ]), clock });
    expect(await p.evaluate(['principal-operator'])).toEqual([]);
  });
});
