'use client';
import { useEffect, useState } from 'react';

/** Viewport size; re-renders only on resize, coalesced to one per frame. */
export function useViewport(): { width: number; height: number } {
  const [size, setSize] = useState({ width: 1920, height: 1080 });
  useEffect(() => {
    let frame = 0;
    const update = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => setSize({ width: window.innerWidth, height: window.innerHeight })); };
    update();
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
