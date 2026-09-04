import { z } from 'zod';
import { defineCapability } from '@jarvis/capability-sdk';
const common = { input: z.object({}), output: z.object({}), risk: 'LOW' as const, reversible: false, idempotent: true, requiredScopes: [], approvalPolicy: 'default' as const, verificationStrategy: { kind: 'adapter' as const, adapterRef: 'read' }, sideEffects: [] };
export default defineCapability({
  id: 'capabilities.chaos', version: '1.0.0', description: 'deterministic chaos fixture', provider: 'chaos', credentialKind: 'none', executionEnvironment: 'worker', auditPolicy: { hashInput: true, recordOutput: 'none' }, privacyRequirements: { maxContentPrivacyClass: 'INTERNAL' },
  actions: {
    crash: { ...common, timeoutMs: 5000, async execute() { throw new Error('simulated worker crash'); }, async verify() { return { verified: false, checks: [] }; } },
    hang: { ...common, timeoutMs: 100, async execute() { return new Promise<never>(() => undefined); }, async verify() { return { verified: false, checks: [] }; } },
    read: { ...common, risk: 'AMBIENT', timeoutMs: 1000, async execute() { return {}; }, async verify() { return { verified: true, checks: [] }; } },
  },
});
