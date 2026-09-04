import type { AdapterContext, VerificationReport, VerificationStrategy } from '@jarvis/contracts';
import { canonicalJson, valueAtPath } from '../../runtime/canonical-json.ts';

export interface AdapterRunner { execute(action: string, ctx: AdapterContext, input: unknown): Promise<unknown>; verify?(action: string, ctx: AdapterContext, input: unknown, output: unknown, strategy: VerificationStrategy): Promise<VerificationReport>; rollback?(action: string, ctx: AdapterContext, input: unknown): Promise<void>; simulate?(action: string, ctx: AdapterContext, input: unknown): Promise<unknown>; }

export interface VerificationWorld {
  read(adapterRef: string, input: unknown): Promise<unknown>;
  readPath(path: string, input: unknown): Promise<unknown>;
  awaitEvent(eventType: string, matchPath: string, timeoutMs: number): Promise<boolean>;
}

/** Executor-owned strategy interpreter. Adapter self-reports never decide completion. */
export class VerificationRunner {
  constructor(private readonly world: VerificationWorld) {}
  async run(input: unknown, output: unknown, strategy: VerificationStrategy): Promise<VerificationReport> {
    if (strategy.kind === 'event-await') {
      const ok = await this.world.awaitEvent(strategy.eventType, strategy.matchPath, strategy.timeoutMs);
      return { verified: ok, checks: [{ name: 'event-await', ok, detail: strategy.eventType }] };
    }
    if (strategy.kind === 'hash-match') {
      const actual = await this.world.readPath(strategy.ofPath, input);
      const expected = valueAtPath(output, strategy.expectPath);
      const ok = typeof actual === 'string' && actual === expected;
      return { verified: ok, checks: [{ name: 'hash-match', ok, detail: strategy.ofPath }] };
    }
    const actual = await this.world.read(strategy.adapterRef, input);
    const expected = output;
    const ok = canonicalJson(actual) === canonicalJson(expected);
    return { verified: ok, checks: [{ name: strategy.kind, ok, detail: strategy.adapterRef }] };
  }
}
