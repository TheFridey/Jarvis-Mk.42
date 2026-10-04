import { describe, expect, it } from 'vitest';
import { assignSlots, emptySlotRegistry, parseSlots, serialiseSlots, SLOT_RESERVE_MS, slotAngle } from './model-slot-registry.ts';

const cloud = (modelId: string) => ({ modelId, locality: 'cloud-ok' as const });
const local = (modelId: string) => ({ modelId, locality: 'local' as const });

describe('model slot registry', () => {
  it('assigns by identity, not array order', () => {
    const first = assignSlots(emptySlotRegistry(), [cloud('a'), cloud('b'), local('l')], 0);
    const reordered = assignSlots(first.registry, [local('l'), cloud('b'), cloud('a')], 1_000);
    for (const id of ['a', 'b', 'l']) expect(reordered.slots.get(id)).toEqual(first.slots.get(id));
  });

  it('separates cloud, local and unknown locality arcs', () => {
    const { slots } = assignSlots(emptySlotRegistry(), [cloud('a'), local('l'), { modelId: 'u' }], 0);
    expect(slots.get('a')!.arc).toBe('cloud');
    expect(slots.get('l')!.arc).toBe('local');
    expect(slots.get('u')!.arc).toBe('neutral');
    expect(slotAngle(slots.get('a')!)).toBeGreaterThan(slotAngle(slots.get('u')!));
    expect(slotAngle(slots.get('l')!)).toBeLessThan(slotAngle(slots.get('u')!));
  });

  it('keeps a departed model reserved and lets it return in place', () => {
    const first = assignSlots(emptySlotRegistry(), [cloud('a'), cloud('b')], 0);
    const gone = assignSlots(first.registry, [cloud('b')], 1_000);
    const newcomer = assignSlots(gone.registry, [cloud('b'), cloud('c')], 2_000);
    expect(newcomer.slots.get('c')).not.toEqual(first.slots.get('a'));
    const back = assignSlots(newcomer.registry, [cloud('a'), cloud('b'), cloud('c')], 3_000);
    expect(back.slots.get('a')).toEqual(first.slots.get('a'));
    expect(back.slots.get('b')).toEqual(first.slots.get('b'));
  });

  it('releases reservations after the reserve window', () => {
    const first = assignSlots(emptySlotRegistry(), [cloud('a')], 0);
    const later = assignSlots(first.registry, [cloud('z')], SLOT_RESERVE_MS + 1);
    expect(later.registry.entries.a).toBeUndefined();
    expect(later.slots.get('z')).toEqual(first.slots.get('a'));
  });

  it('never displaces a present model when an arc is full', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const full = assignSlots(emptySlotRegistry(), ids.map(cloud), 0);
    const over = assignSlots(full.registry, [...ids, 'f'].map(cloud), 1_000);
    for (const id of ids) expect(over.slots.get(id)).toEqual(full.slots.get(id));
    expect(over.slots.get('f')!.arc).toBe('neutral');
  });

  it('moves a provisional neutral slot into its arc once locality is observed', () => {
    const unknown = assignSlots(emptySlotRegistry(), [{ modelId: 'a' }], 0);
    const known = assignSlots(unknown.registry, [cloud('a')], 1_000);
    expect(known.slots.get('a')!.arc).toBe('cloud');
    const forgetful = assignSlots(known.registry, [{ modelId: 'a' }], 2_000);
    expect(forgetful.slots.get('a')!.arc).toBe('cloud');
  });

  it('round-trips through session storage and rejects malformed entries', () => {
    const { registry } = assignSlots(emptySlotRegistry(), [cloud('a'), local('l')], 0);
    expect(parseSlots(serialiseSlots(registry))).toEqual(registry);
    expect(parseSlots('{"entries":{"x":{"modelId":"x","arc":"cloud","index":99,"lastSeenAt":0}}}')).toEqual(emptySlotRegistry());
    expect(parseSlots('not json')).toEqual(emptySlotRegistry());
  });
});
