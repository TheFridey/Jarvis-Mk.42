/**
 * ULID generation. Monotonic within the process so that per-subject event
 * ordering holds for the single-writer Kernel (EVENT_ARCHITECTURE.md sec 4).
 * A DB-level per-subject sequence is the hardening for a multi-writer future.
 */
import { monotonicFactory, ulid as ulidRandom } from 'ulid';

export interface IdGen {
  ulid(seedTime?: number): string;
}

export class UlidGen implements IdGen {
  private readonly mono = monotonicFactory();
  ulid(seedTime?: number): string {
    return this.mono(seedTime);
  }
}

/** Non-monotonic, for tests that just need a valid ULID. */
export function randomUlid(): string {
  return ulidRandom();
}
