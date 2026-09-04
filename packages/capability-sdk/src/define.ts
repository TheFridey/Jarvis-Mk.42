import type { AdapterContext, Capability, PredictedEffect, RollbackReport, VerificationReport } from '@jarvis/contracts';
import type { z } from 'zod';
import { zodToJsonSchema } from './schema.ts';

const INTRUSION = /\b(exploit|bruteforce|port-scan|payload|c2|keylog|exfiltrate)\b/i;
export interface ActionDefinition<I = unknown, O = unknown> {
  input: z.ZodType<I>; output: z.ZodType<O>;
  risk: Capability['actions'][number]['riskClass']; reversible: boolean; idempotent: boolean;
  requiredScopes: string[]; approvalPolicy: Capability['actions'][number]['approvalPolicy']; timeoutMs: number;
  verificationStrategy: Capability['actions'][number]['verificationStrategy']; rollbackStrategy?: Capability['actions'][number]['rollbackStrategy'];
  sideEffects: string[]; simulatable?: boolean; idempotencyKeySelector?: string; confirmationPhrase?: string; declaredEgress?: string[];
  execute(ctx: AdapterContext, input: I): Promise<O>;
  verify(ctx: AdapterContext, input: I, output: O): Promise<VerificationReport>;
  rollback?(ctx: AdapterContext, input: I, before: unknown): Promise<RollbackReport>;
  simulate?(ctx: AdapterContext, input: I): Promise<PredictedEffect>;
}
export interface CapabilityDefinition {
  id: string; version: string; description: string; provider: string;
  executionEnvironment: Capability['executionEnvironment']; auditPolicy: Capability['auditPolicy']; privacyRequirements: Capability['privacyRequirements'];
  trustTierMin?: Capability['trustTierMin']; resourceKeySelector?: string; active?: boolean;
  // The runtime schemas validate concrete values before these erased action slots run.
  actions: Record<string, ActionDefinition<any, any>>;
}
export interface CapabilityModule { manifest: Capability & { active?: boolean }; actions: CapabilityDefinition['actions']; }

export function defineCapability(def: CapabilityDefinition): CapabilityModule {
  if (!/^capabilities\.[a-z][a-z0-9_]*$/.test(def.id)) throw new Error('invalid capability id');
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(def.version)) throw new Error('invalid semver version');
  const actions = Object.entries(def.actions).map(([name, action]) => {
    if (typeof action.verify !== 'function') throw new Error(`${name}: verify is required`);
    if (action.reversible && action.sideEffects.length > 0 && typeof action.rollback !== 'function') throw new Error(`${name}: rollback is required`);
    if (action.risk === 'CRITICAL' && !action.confirmationPhrase) throw new Error(`${name}: confirmationPhrase is required`);
    if (action.sideEffects.some((effect) => INTRUSION.test(effect))) throw new Error(`${name}: offensive sideEffect is forbidden`);
    return {
      name, inputSchema: zodToJsonSchema(action.input), outputSchema: zodToJsonSchema(action.output),
      riskClass: action.risk, reversible: action.reversible, rollback: action.rollback ? 'rollback' : undefined,
      simulate: action.simulate ? 'simulate' : undefined, simulatable: action.simulatable ?? Boolean(action.simulate), verify: 'verify',
      idempotent: action.idempotent, sideEffects: action.sideEffects, approvalPolicy: action.approvalPolicy,
      timeoutMs: action.timeoutMs, verificationStrategy: action.verificationStrategy, rollbackStrategy: action.rollbackStrategy,
      idempotencyKeySelector: action.idempotencyKeySelector, confirmationPhrase: action.confirmationPhrase, declaredEgress: action.declaredEgress,
    };
  });
  return { manifest: {
    id: def.id, version: def.version, description: def.description, provider: def.provider,
    executionEnvironment: def.executionEnvironment, auditPolicy: def.auditPolicy, privacyRequirements: def.privacyRequirements,
    actions, requiredScopes: [...new Set(actions.flatMap((_, i) => Object.values(def.actions)[i]?.requiredScopes ?? []))],
    trustTierMin: def.trustTierMin ?? 'owned-secure', resourceKeySelector: def.resourceKeySelector, active: def.active,
  }, actions: def.actions };
}
