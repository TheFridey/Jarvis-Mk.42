'use client';
import { useEffect, useLayoutEffect, useState } from 'react';

/**
 * Viewport size; measured before first client paint, then re-renders only on resize, coalesced to one per frame.
 * `measured` is false in the prerendered HTML, whose layout assumes 1920x1080 and must not be shown.
 */
export function useViewport(): { width: number; height: number; measured: boolean } {
  const [size, setSize] = useState({ width: 1920, height: 1080, measured: false });
  useLayoutEffect(() => {
    let frame = 0;
    const measure = () => setSize({ width: window.innerWidth, height: window.innerHeight, measured: true });
    const update = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    measure();
    window.addEventListener('resize', update);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', update); };
  }, []);
  return size;
}

/** Wall clock for data-age labels. Leaf components only; never drives animation. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), intervalMs); return () => clearInterval(timer); }, [intervalMs]);
  return now;
}
