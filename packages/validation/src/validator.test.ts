import { describe, expect, it } from 'vitest';
import { validateEvent, validateEventDraft } from './validator.ts';

const baseDraft = {
  type: 'jarvis.kernel.mode.changed',
  schemaVersion: 1,
  retentionClass: 'OPERATIONAL',
  time: '2026-09-01T00:00:00.000Z',
  source: { node: 'local-server', component: 'mode-manager' },
  subject: { kind: 'mode', id: 'system' },
  actor: { kind: 'system', id: 'mode-manager' },
  provenance: {
    method: 'system',
    producedBy: 'mode-manager',
    producedOn: 'local-server',
    producedAt: '2026-09-01T00:00:00.000Z',
    correlationId: 'c1',
    derivedFromUntrusted: false,
  },
  causationId: 'none',
  correlationId: 'c1',
  principalId: 'system',
  privacyClass: 'INTERNAL',
  payload: { from: 'DORMANT', to: 'AMBIENT', trigger: 'operator_request', reason: 'boot', version: 1 },
};

describe('event validator', () => {
  it('accepts a well-formed draft for a known type', () => {
    const r = validateEventDraft(baseDraft);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.unknownType).toBe(false);
  });

  it('rejects a bad retentionClass (schema mismatch)', () => {
    const r = validateEventDraft({ ...baseDraft, retentionClass: 'FOREVER' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.path === 'retentionClass')).toBe(true);
  });

  it('rejects a malformed type string', () => {
    const r = validateEventDraft({ ...baseDraft, type: 'mode.changed' });
    expect(r.ok).toBe(false);
  });

  it('rejects a payload that does not match the per-type schema', () => {
    const r = validateEventDraft({ ...baseDraft, payload: { from: 'DORMANT' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]!.path.startsWith('payload')).toBe(true);
  });

  it('lets an unknown event type through with a permissive payload, flagged', () => {
    const r = validateEventDraft({
      ...baseDraft,
      type: 'jarvis.kernel.future.invented',
      payload: { anything: [1, 2, 3] },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.unknownType).toBe(true);
  });

  it('requires privacyClass', () => {
    const { privacyClass: _omit, ...noPrivacy } = baseDraft;
    const r = validateEventDraft(noPrivacy);
    expect(r.ok).toBe(false);
  });

  it('validateEvent additionally requires id + recordedAt', () => {
    const r = validateEvent(baseDraft);
    expect(r.ok).toBe(false);
    const full = { ...baseDraft, id: '01J000000000000000000000AA', recordedAt: baseDraft.time };
    expect(validateEvent(full).ok).toBe(true);
  });
});
