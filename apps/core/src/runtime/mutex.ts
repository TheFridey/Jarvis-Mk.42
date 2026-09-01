/**
 * Minimal async mutex + keyed mutex. Used to serialise state transitions that
 * must not interleave (mode changes, per-session transitions, per-subsystem
 * health updates) within the single Kernel process.
 */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    // keep the chain alive but swallow rejection so one failure doesn't wedge it
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export class KeyedMutex {
  private readonly locks = new Map<string, Mutex>();

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    let m = this.locks.get(key);
    if (!m) {
      m = new Mutex();
      this.locks.set(key, m);
    }
    return m.run(fn);
  }
}
