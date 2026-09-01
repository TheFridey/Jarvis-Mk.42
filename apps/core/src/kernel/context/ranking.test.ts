import { describe, expect, it } from 'vitest';
import type { ContextItem, ContextRequest } from '@jarvis/contracts';
import { buildPackage, scoreItem, type RankInput } from './ranking.ts';

const prov = {
  method: 'derivation' as const,
  producedBy: 'test',
  producedOn: 'n',
  producedAt: '2026-09-01T00:00:00Z',
  correlationId: 'c',
  derivedFromUntrusted: false,
};

const item = (over: Partial<ContextItem>): ContextItem => ({
  id: Math.random().toString(36).slice(2),
  kind: 'recent_event',
  summary: 's',
  content: {},
  provenance: prov,
  privacyClass: 'INTERNAL',
  relevance: 0.5,
  sizeUnits: 10,
  contentHash: Math.random().toString(36).slice(2),
  ...over,
});

const req: ContextRequest = {
  correlationId: 'c',
  intent: 'answer the user',
  intentClass: 'reason',
  budgetUnits: 50,
  maxPrivacyClass: 'SENSITIVE',
};

describe('context ranking + budgeting', () => {
  it('never exceeds the unit budget and lists what it omitted', () => {
    const items = Array.from({ length: 20 }, (_, i) =>
      item({ sizeUnits: 10, relevance: 1 - i * 0.01, summary: `item-${i}` }),
    );
    const r = buildPackage(items, req);
    expect(r.usedUnits).toBeLessThanOrEqual(req.budgetUnits);
    expect(r.truncated).toBe(true);
    expect(r.omitted.length).toBe(20 - r.kept.length);
    // highest-relevance kept
    expect(r.kept[0]!.summary).toBe('item-0');
  });

  it('filters items above the privacy ceiling', () => {
    const items = [
      item({ privacyClass: 'PUBLIC', sizeUnits: 5 }),
      item({ privacyClass: 'RESTRICTED', sizeUnits: 5 }),
      item({ privacyClass: 'SENSITIVE', sizeUnits: 5 }),
    ];
    const r = buildPackage(items, { ...req, maxPrivacyClass: 'INTERNAL' });
    expect(r.byPrivacy).toBe(2);
    expect(r.kept.every((i) => i.privacyClass === 'PUBLIC')).toBe(true);
  });

  it('dedupes by contentHash', () => {
    const items = [
      item({ contentHash: 'same', sizeUnits: 5 }),
      item({ contentHash: 'same', sizeUnits: 5 }),
      item({ contentHash: 'other', sizeUnits: 5 }),
    ];
    const r = buildPackage(items, req);
    expect(r.byDedupe).toBe(1);
    expect(r.kept.length).toBe(2);
  });

  it('is deterministic: stable sort by relevance then contentHash', () => {
    const items = [
      item({ relevance: 0.5, contentHash: 'b', sizeUnits: 1 }),
      item({ relevance: 0.5, contentHash: 'a', sizeUnits: 1 }),
    ];
    const r1 = buildPackage(items, req);
    const r2 = buildPackage([...items].reverse(), req);
    expect(r1.kept.map((i) => i.contentHash)).toEqual(['a', 'b']);
    expect(r2.kept.map((i) => i.contentHash)).toEqual(['a', 'b']);
  });

  it('scoreItem gives objective-defining items the highest base relevance', () => {
    const obj = scoreItem({ ...(item({ kind: 'active_objective' }) as RankInput) }, req);
    const evt = scoreItem({ ...(item({ kind: 'recent_event' }) as RankInput) }, req);
    expect(obj).toBeGreaterThan(evt);
  });

  it('penalises untrusted-derived items', () => {
    const trusted = scoreItem(item({ kind: 'evidence' }) as RankInput, req);
    const untrusted = scoreItem(
      item({ kind: 'evidence', provenance: { ...prov, derivedFromUntrusted: true } }) as RankInput,
      req,
    );
    expect(untrusted).toBeLessThan(trusted);
  });
});
