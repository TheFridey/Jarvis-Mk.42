/**
 * Injectable clock. Real in production; a controllable fake in tests so
 * time-based behaviour (dwell, retention windows, retries) is deterministic.
 */
export interface Clock {
  now(): Date;
  nowIso(): string;
  /** ms since epoch. */
  epochMs(): number;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
  nowIso(): string {
    return new Date().toISOString();
  }
  epochMs(): number {
    return Date.now();
  }
}

export class FakeClock implements Clock {
  private ms: number;
  constructor(start: Date | number = 0) {
    this.ms = typeof start === 'number' ? start : start.getTime();
  }
  now(): Date {
    return new Date(this.ms);
  }
  nowIso(): string {
    return new Date(this.ms).toISOString();
  }
  epochMs(): number {
    return this.ms;
  }
  advance(ms: number): void {
    this.ms += ms;
  }
  set(to: Date | number): void {
    this.ms = typeof to === 'number' ? to : to.getTime();
  }
}
