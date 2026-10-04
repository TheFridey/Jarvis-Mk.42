'use client';
import { createContext, useContext, useMemo, useRef, type ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { Point, SpatialLayout } from '../spatial-layout-policy.ts';
import { MOTION } from '../visual-tokens.ts';

/**
 * Scene clock shared by every GPU layer. `t` advances by real time scaled by
 * policy motion and communication-loss freeze, so all motion slows and stops
 * together. `dt` is real elapsed time for damping toward new targets.
 */
export interface CosmosClock { t: number; dt: number; scale: number; snap: boolean }
/** Just above the slowest regular frame (12fps idle cap). */
export const MAX_FRAME_DT = .1;
const ClockContext = createContext<CosmosClock>({ t: 0, dt: 0, scale: 0, snap: true });

export function CosmosClockProvider({ motion, staleSince, current, children }: { motion: number; staleSince?: number; current: boolean; children: ReactNode }) {
  const clock = useRef<CosmosClock>({ t: 0, dt: 0, scale: 0, snap: true }).current;
  const config = useRef({ motion, staleSince, current });
  config.current = { motion, staleSince, current };
  useFrame((_, delta) => {
    const { motion: m, staleSince: since, current: live } = config.current;
    const freeze = live ? 0 : since === undefined ? 1 : Math.min(1, Math.max(0, (Date.now() - since) / (MOTION.freeze * 1000)));
    clock.scale = m * (1 - freeze);
    // A render stall (shader compile on a new node) must slow motion, not make damped positions leap.
    clock.dt = Math.min(delta, MAX_FRAME_DT);
    clock.t += clock.dt * clock.scale;
    clock.snap = m === 0;
  });
  return <ClockContext.Provider value={clock}>{children}</ClockContext.Provider>;
}
export const useCosmosClock = () => useContext(ClockContext);

/** Damping rate that snaps under reduced motion. */
export const rate = (clock: CosmosClock, value: number) => clock.snap ? Number.POSITIVE_INFINITY : value;

export interface World { k: number; toWorld: (point: Point) => [number, number]; radius: (px: number) => number }
/** Maps shared layout pixels onto the z=0 plane. */
export function useWorld(layout: SpatialLayout): World {
  const size = useThree(state => state.size);
  const viewport = useThree(state => state.viewport);
  return useMemo(() => {
    const sx = size.width / layout.width, sy = size.height / layout.height;
    const k = viewport.width / size.width;
    return {
      k: k * sx,
      toWorld: (p: Point) => [(p.x * sx - size.width / 2) * k, (size.height / 2 - p.y * sy) * k],
      radius: (px: number) => px * sx * k,
    };
  }, [size.width, size.height, viewport.width, layout.width, layout.height]);
}
