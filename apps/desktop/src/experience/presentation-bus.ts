/**
 * Frame-synchronous bridge from the GPU scene to the DOM projections. The GPU
 * render loop writes the damped framing and per-element offsets here in the
 * same frame it draws them, so labels never drift from their geometry. An
 * offset element is anchored at a fixed point and moved only by `translate`:
 * React re-renders never move it, so a state change cannot snap a label ahead
 * of its geometry. With no GPU scene (WebGL fallback) nothing writes and each
 * element shows its registered fallback offset, its layout position.
 */
const layers = new Set<HTMLElement>();
const offsetTargets = new Map<string, { element: HTMLElement; fallback: string }>();
const lastFraming = { a: 0, b: 0, s: 1 };
const lastOffsets = new Map<string, string>();

const round = (value: number) => Math.round(value * 100) / 100;
const format = (dx: number, dy: number) => `${round(dx)}px ${round(dy)}px`;

export const presentationBus = {
  registerLayer(element: HTMLElement): () => void {
    layers.add(element);
    writeFraming(element);
    return () => { layers.delete(element); element.style.transform = ''; };
  },
  /** `fallback` is the layout offset from the anchor, used until (or unless) the GPU writes one. */
  registerOffset(id: string, element: HTMLElement, fallback: { dx: number; dy: number }): () => void {
    const entry = { element, fallback: format(fallback.dx, fallback.dy) };
    offsetTargets.set(id, entry);
    element.style.translate = lastOffsets.get(id) ?? entry.fallback;
    return () => { if (offsetTargets.get(id) === entry) offsetTargets.delete(id); };
  },
  framing(a: number, b: number, s: number) {
    if (Math.abs(a - lastFraming.a) < .05 && Math.abs(b - lastFraming.b) < .05 && Math.abs(s - lastFraming.s) < .00005) return;
    lastFraming.a = a; lastFraming.b = b; lastFraming.s = s;
    layers.forEach(writeFraming);
  },
  /** GPU position of an offset element relative to its anchor, in layout pixels. */
  offset(id: string, dx: number, dy: number) {
    const value = format(dx, dy);
    if (lastOffsets.get(id) === value) return;
    lastOffsets.set(id, value);
    const target = offsetTargets.get(id);
    if (target) target.element.style.translate = value;
  },
  /** The GPU no longer draws this element: return it to its layout position. */
  release(id: string) {
    lastOffsets.delete(id);
    const target = offsetTargets.get(id);
    if (target) target.element.style.translate = target.fallback;
  },
  reset() {
    lastFraming.a = 0; lastFraming.b = 0; lastFraming.s = 1;
    layers.forEach(writeFraming);
    lastOffsets.clear();
    offsetTargets.forEach(target => { target.element.style.translate = target.fallback; });
  },
  snapshot() { return { framing: { ...lastFraming }, offsets: Object.fromEntries(lastOffsets) }; },
};

function writeFraming(element: HTMLElement) {
  const { a, b, s } = lastFraming;
  element.style.transform = a === 0 && b === 0 && s === 1 ? '' : `translate(${round(a)}px, ${round(b)}px) scale(${s.toFixed(5)})`;
}
