/**
 * Presentation-only slot registry: modelId -> constellation slot. A model keeps
 * its slot for the whole desktop session so the operator learns where each
 * model lives. Slots never derive from array order, and a model that drops out
 * of the projection keeps its slot reserved briefly so it can return in place.
 */
export type SlotArc = 'cloud' | 'local' | 'neutral';
export interface SlotRef { arc: SlotArc; index: number }

export const SLOT_CAPACITY: Record<SlotArc, number> = { cloud: 5, local: 5, neutral: 2 };
/** Fill order inside an arc: the middle of the arc first, the extremes last. */
const FILL_ORDER: Record<SlotArc, number[]> = { cloud: [1, 2, 0, 3, 4], local: [1, 2, 0, 3, 4], neutral: [0, 1] };
export const SLOT_RESERVE_MS = 120_000;

interface SlotEntry extends SlotRef { modelId: string; lastSeenAt: number }
export interface SlotRegistry { entries: Record<string, SlotEntry> }
export const emptySlotRegistry = (): SlotRegistry => ({ entries: {} });

export const arcOf = (locality: 'local' | 'cloud-ok' | undefined): SlotArc => locality === 'cloud-ok' ? 'cloud' : locality === 'local' ? 'local' : 'neutral';

function freeIndex(entries: Record<string, SlotEntry>, arc: SlotArc): number | undefined {
  const taken = new Set(Object.values(entries).filter(entry => entry.arc === arc).map(entry => entry.index));
  return FILL_ORDER[arc].find(index => !taken.has(index));
}

/** Oldest reserved (currently absent) entry in an arc; present models are never displaced. */
function evictable(entries: Record<string, SlotEntry>, arc: SlotArc, present: Set<string>): SlotEntry | undefined {
  return Object.values(entries).filter(entry => entry.arc === arc && !present.has(entry.modelId)).sort((a, b) => a.lastSeenAt - b.lastSeenAt)[0];
}

export function assignSlots(registry: SlotRegistry, models: Array<{ modelId: string; locality?: 'local' | 'cloud-ok' }>, now: number): { registry: SlotRegistry; slots: Map<string, SlotRef> } {
  const entries: Record<string, SlotEntry> = {};
  const present = new Set(models.map(model => model.modelId));
  for (const entry of Object.values(registry.entries)) {
    if (present.has(entry.modelId) || now - entry.lastSeenAt <= SLOT_RESERVE_MS) entries[entry.modelId] = { ...entry };
  }
  for (const model of models) {
    const entry = entries[model.modelId];
    const arc = arcOf(model.locality);
    // A neutral slot is provisional: once locality is observed the model moves to its arc.
    if (entry && (entry.arc === arc || (arc === 'neutral' && entry.arc !== 'neutral'))) { entry.lastSeenAt = now; continue; }
    if (entry) delete entries[model.modelId];
    let index = freeIndex(entries, arc);
    let target: SlotArc = arc;
    if (index === undefined) {
      const victim = evictable(entries, arc, present);
      if (victim) { delete entries[victim.modelId]; index = victim.index; }
    }
    if (index === undefined && arc !== 'neutral') { target = 'neutral'; index = freeIndex(entries, 'neutral'); }
    if (index === undefined) continue;
    entries[model.modelId] = { modelId: model.modelId, arc: target, index, lastSeenAt: now };
  }
  const slots = new Map<string, SlotRef>();
  for (const model of models) { const entry = entries[model.modelId]; if (entry) slots.set(model.modelId, { arc: entry.arc, index: entry.index }); }
  return { registry: { entries }, slots };
}

/** Screen-space polar angle of a slot, degrees; cloud above the boundary, local below. */
export function slotAngle(slot: SlotRef): number {
  if (slot.arc === 'neutral') return slot.index === 0 ? 5 : -5;
  const angle = 16 + slot.index * 11;
  return slot.arc === 'cloud' ? angle : -angle;
}

export function serialiseSlots(registry: SlotRegistry): string { return JSON.stringify(registry); }
export function parseSlots(raw: string | null): SlotRegistry {
  if (!raw) return emptySlotRegistry();
  try {
    const value = JSON.parse(raw) as SlotRegistry;
    const entries: Record<string, SlotEntry> = {};
    for (const entry of Object.values(value.entries ?? {})) {
      if (typeof entry?.modelId === 'string' && (entry.arc === 'cloud' || entry.arc === 'local' || entry.arc === 'neutral') && Number.isInteger(entry.index) && entry.index >= 0 && entry.index < SLOT_CAPACITY[entry.arc] && Number.isFinite(entry.lastSeenAt)) entries[entry.modelId] = entry;
    }
    return { entries };
  } catch { return emptySlotRegistry(); }
}
