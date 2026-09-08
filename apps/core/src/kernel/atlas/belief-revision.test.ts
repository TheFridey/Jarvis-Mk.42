import { describe, expect, it } from 'vitest';
import type { Fact } from '@jarvis/contracts';
import { reviseBelief, type IncomingFact } from './belief-revision.ts';

const fact = (over: Partial<Fact>): Fact => ({
  id: over.id ?? 'F1',
  subjectEntityId: 'E1',
  attribute: 'role',
  value: 'engineer',
  epistemicStatus: 'inferred',
  provenance: { method: 'inference', producedBy: 't', producedOn: 'n', producedAt: '2026-09-01T00:00:00.000Z', correlationId: 'c', derivedFromUntrusted: false },
  confidence: 0.6,
  validFrom: '2026-09-01T00:00:00.000Z',
  status: 'active',
  privacyClass: 'INTERNAL',
  contradictionOf: [],
  createdAt: '2026-09-01T00:00:00.000Z',
  ...over,
});

const incoming = (over: Partial<IncomingFact>): IncomingFact => ({
  attribute: 'role',
  value: 'founder',
  epistemicStatus: 'inferred',
  confidence: 0.6,
  validFrom: '2026-09-02T00:00:00.000Z',
  principalAsserted: false,
  ...over,
});

describe('reviseBelief', () => {
  it('inserts the first fact for a key', () => {
    expect(reviseBelief([], incoming({})).action).toBe('insert_only');
  });

  it('inserts alongside when the value agrees', () => {
    const r = reviseBelief([fact({ value: 'founder' })], incoming({ value: 'founder' }));
    expect(r.action).toBe('insert_only');
  });

  it('supersedes a weaker belief when incoming has higher epistemic authority', () => {
    const r = reviseBelief([fact({ epistemicStatus: 'inferred' })], incoming({ epistemicStatus: 'observed' }));
    expect(r).toMatchObject({ action: 'supersede', supersedeFactIds: ['F1'] });
  });

  it('opens a conflict when authority, recency and confidence are all comparable', () => {
    const r = reviseBelief(
      [fact({ epistemicStatus: 'observed', validFrom: '2026-09-02T00:00:00.000Z', confidence: 0.7 })],
      incoming({ epistemicStatus: 'observed', validFrom: '2026-09-02T00:00:00.000Z', confidence: 0.7 }),
    );
    expect(r.action).toBe('conflict');
    if (r.action === 'conflict') {
      expect(r.resolvedByPrincipal).toBe(false);
      expect(r.conflictWithFactIds).toEqual(['F1']);
    }
  });

  it('does NOT supersede when the incoming fact is weaker — it conflicts instead', () => {
    const r = reviseBelief([fact({ epistemicStatus: 'asserted' })], incoming({ epistemicStatus: 'predicted' }));
    expect(r.action).toBe('conflict');
  });

  it('equal authority: newer validFrom supersedes', () => {
    const r = reviseBelief(
      [fact({ epistemicStatus: 'inferred', validFrom: '2026-09-01T00:00:00.000Z' })],
      incoming({ epistemicStatus: 'inferred', validFrom: '2026-09-05T00:00:00.000Z' }),
    );
    expect(r).toMatchObject({ action: 'supersede', supersedeFactIds: ['F1'] });
  });

  it('a principal assertion always wins and flags resolvedByPrincipal', () => {
    const r = reviseBelief(
      [fact({ epistemicStatus: 'asserted', confidence: 0.99 })],
      incoming({ principalAsserted: true, epistemicStatus: 'asserted' }),
    );
    expect(r.action).toBe('conflict');
    if (r.action === 'conflict') expect(r.resolvedByPrincipal).toBe(true);
  });

  it('confidence only breaks a tie past the margin', () => {
    const base = { epistemicStatus: 'inferred' as const, validFrom: '2026-09-02T00:00:00.000Z' };
    expect(
      reviseBelief([fact({ ...base, confidence: 0.6 })], incoming({ ...base, confidence: 0.62 })).action,
    ).toBe('conflict');
    expect(
      reviseBelief([fact({ ...base, confidence: 0.6 })], incoming({ ...base, confidence: 0.85 })).action,
    ).toBe('supersede');
  });
});
