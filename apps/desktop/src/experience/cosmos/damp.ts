/** Frame-rate independent exponential approach. `rate` in 1/s; Infinity snaps. */
export function damp(current: number, target: number, rate: number, dt: number): number {
  if (rate === Number.POSITIVE_INFINITY) return target;
  if (dt <= 0) return current;
  return target + (current - target) * Math.exp(-rate * Math.min(dt, .5));
}

/** Shortest-path angular damping, radians. */
export function dampAngle(current: number, target: number, rate: number, dt: number): number {
  if (rate === Number.POSITIVE_INFINITY) return target;
  if (dt <= 0) return current;
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta - delta * Math.exp(-rate * Math.min(dt, .5));
}
