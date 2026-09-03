import { expect, it } from 'vitest';
import { z } from 'zod';
import { defineCapability } from './define.ts';

const base = { id: 'capabilities.sample', version: '1.0.0', description: 'sample', provider: 'sample', executionEnvironment: 'worker' as const,
  auditPolicy: { hashInput: true, recordOutput: 'summary' as const }, privacyRequirements: { maxContentPrivacyClass: 'INTERNAL' as const } };
const action = { input: z.object({ host: z.string() }), output: z.object({ ok: z.boolean() }), risk: 'AMBIENT' as const,
  reversible: false, idempotent: true, requiredScopes: [], approvalPolicy: 'default' as const, timeoutMs: 1000,
  verificationStrategy: { kind: 'world-read' as const, adapterRef: 'verify' }, sideEffects: [],
  async execute() { return { ok: true }; }, async verify() { return { verified: true, checks: [] }; } };

it('generates JSON Schema', () => {
  expect(defineCapability({ ...base, actions: { ping: action } }).manifest.actions[0]?.inputSchema)
    .toMatchObject({ type: 'object', properties: { host: { type: 'string' } } });
});
it('rejects unsafe lifecycle definitions', () => {
  expect(() => defineCapability({ ...base, actions: { bad: { ...action, risk: 'MEDIUM', reversible: true, sideEffects: ['write'] } } })).toThrow(/rollback/);
  expect(() => defineCapability({ ...base, actions: { bad: { ...action, risk: 'CRITICAL' } } })).toThrow(/confirmationPhrase/);
});
