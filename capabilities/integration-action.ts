import { z } from 'zod';
import type { ActionDefinition } from '@jarvis/capability-sdk';
/** Kernel transport owns credentials, destinations and independent readback. */
export function integrationAction(provider: string, name: string, input: z.ZodType, write = false, high = false): ActionDefinition {
  return {
    input, output: z.object({ data: z.unknown() }).strict(), risk: high ? 'HIGH' : write ? 'MEDIUM' : 'LOW',
    reversible: false, idempotent: !write, requiredScopes: [`${provider}.${name}`],
    approvalPolicy: write ? 'always' : 'default', timeoutMs: 30000,
    verificationStrategy: { kind: 'world-read', adapterRef: name },
    sideEffects: write ? [`${provider} ${name}`] : [], declaredEgress: [`integration://${provider}`],
    async execute(ctx, value) { const parsed = input.parse(value); return z.object({ data: z.unknown() }).strict().parse(await ctx.http({ method: ctx.mode === 'dry-run' ? 'GET' : 'POST', url: `integration://${provider}/${name}`, body: parsed })); },
    async verify() { return { verified: false, checks: [{ name: 'executor-readback', ok: false, detail: 'Executor owns verification' }] }; },
  };
}
