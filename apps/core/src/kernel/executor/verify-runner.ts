import type { AdapterContext, VerificationReport, VerificationStrategy } from '@jarvis/contracts';
import { canonicalJson, valueAtPath } from '../../runtime/canonical-json.ts';

export interface AdapterRunner { execute(action: string, ctx: AdapterContext, input: unknown): Promise<unknown>; verify?(action: string, ctx: AdapterContext, input: unknown, output: unknown, strategy: VerificationStrategy): Promise<VerificationReport>; rollback?(action: string, ctx: AdapterContext, input: unknown, before?: unknown): Promise<void>; simulate?(action: string, ctx: AdapterContext, input: unknown): Promise<unknown>; }

export interface VerificationWorld {
  read(adapterRef: string, input: unknown, context?: VerificationContext): Promise<unknown>;
  readPath(path: string, input: unknown, context?: VerificationContext): Promise<unknown>;
  awaitEvent(eventType: string, matchPath: string, timeoutMs: number): Promise<boolean>;
}
export interface VerificationContext { capability: import('@jarvis/contracts').Capability; handle: import('@jarvis/contracts').CredentialHandle; }

/** Executor-owned strategy interpreter. Adapter self-reports never decide completion. */
export class VerificationRunner {
  constructor(private readonly world: VerificationWorld) {}
  async run(input: unknown, output: unknown, strategy: VerificationStrategy, context?: VerificationContext): Promise<VerificationReport> {
    if (strategy.kind === 'event-await') {
      const ok = await this.world.awaitEvent(strategy.eventType, strategy.matchPath, strategy.timeoutMs);
      return { verified: ok, checks: [{ name: 'event-await', ok, detail: strategy.eventType }] };
    }
    if (strategy.kind === 'hash-match') {
      const actual = await this.world.readPath(strategy.ofPath, input, context);
      const expected = valueAtPath(output, strategy.expectPath);
      const ok = typeof actual === 'string' && actual === expected;
      return { verified: ok, checks: [{ name: 'hash-match', ok, detail: strategy.ofPath }] };
    }
    const actual = await this.world.read(strategy.adapterRef, input, context);
    const expected = output;
    const ok = canonicalJson(actual) === canonicalJson(expected);
    return { verified: ok, checks: [{ name: strategy.kind, ok, detail: strategy.adapterRef }] };
  }
  async capture(input: unknown, strategy: VerificationStrategy, context: VerificationContext): Promise<unknown> {
    if (strategy.kind === 'hash-match') return this.world.readPath(strategy.ofPath, input, context);
    if (strategy.kind === 'event-await') return undefined;
    return this.world.read(strategy.adapterRef, input, context);
  }
  async rollbackMatches(input: unknown, strategy: VerificationStrategy, before: unknown, context: VerificationContext): Promise<boolean> {
    const after = await this.capture(input, strategy, context);
    return canonicalJson(after) === canonicalJson(before);
  }
}
