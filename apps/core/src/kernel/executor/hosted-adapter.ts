import { AdapterHost } from '@jarvis/adapter-host';
import type { AdapterContext, Capability } from '@jarvis/contracts';
import type { AdapterRunner, VerificationContext, VerificationWorld } from './verify-runner.ts';
export type { AdapterEgress, AdapterJob } from '@jarvis/adapter-host';
export { EgressRefusal } from '@jarvis/adapter-host';

export type AdapterModuleCatalog = ReadonlyMap<string, string>;
export function createAdapterHost(egress?: import('@jarvis/adapter-host').AdapterEgress) { return new AdapterHost(undefined, egress); }

export class HostedAdapterRunner implements AdapterRunner {
  constructor(private readonly host: AdapterHost, private readonly capability: Capability, private readonly moduleUrl: string) {}
  async execute(action: string, ctx: AdapterContext, input: unknown) { return (await this.run(action, 'execute', ctx, input)).output; }
  async simulate(action: string, ctx: AdapterContext, input: unknown) { return (await this.run(action, 'simulate', ctx, input)).output; }
  async rollback(action: string, ctx: AdapterContext, input: unknown, before?: unknown) { await this.run(action, 'rollback', ctx, input, before); }
  private run(action: string, operation: 'execute' | 'simulate' | 'rollback', ctx: AdapterContext, input: unknown, before?: unknown) {
    const manifestAction = this.capability.actions.find((candidate) => candidate.name === action);
    if (!manifestAction) throw new Error('adapter action not registered');
    return this.host.run({ invocationId: ctx.credential.invocationId, capabilityId: this.capability.id, version: this.capability.version, action, operation, input, before, handle: ctx.credential, mode: ctx.mode, timeoutMs: manifestAction.timeoutMs, riskClass: manifestAction.riskClass, executionEnvironment: this.capability.executionEnvironment, moduleUrl: this.moduleUrl });
  }
}

export class HostedVerificationWorld implements VerificationWorld {
  constructor(private readonly host: AdapterHost, private readonly modules: AdapterModuleCatalog) {}
  async read(adapterRef: string, input: unknown, context?: VerificationContext) { if (!context) throw new Error('verification context unavailable'); return this.run(context, adapterRef, 'execute', input); }
  async readPath(_path: string, input: unknown, context?: VerificationContext) { if (!context) throw new Error('verification context unavailable'); return this.run(context, context.capability.actions[0]?.name ?? '', 'hash-file', input); }
  async awaitEvent() { return false; }
  private async run(context: VerificationContext, action: string, operation: 'execute' | 'hash-file', input: unknown) {
    const moduleUrl = this.modules.get(context.capability.id); if (!moduleUrl) throw new Error('adapter module unavailable');
    const manifestAction = context.capability.actions.find((candidate) => candidate.name === action) ?? context.capability.actions[0]; if (!manifestAction) throw new Error('verification action unavailable');
    const result = await this.host.run({ invocationId: context.handle.invocationId, capabilityId: context.capability.id, version: context.capability.version, action: manifestAction.name, operation, input, output: context.output, handle: context.handle, mode: 'dry-run', timeoutMs: manifestAction.timeoutMs, riskClass: manifestAction.riskClass, executionEnvironment: context.capability.executionEnvironment, moduleUrl });
    return result.output;
  }
}
