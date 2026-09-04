import type { CredentialHandle, RiskClass } from '@jarvis/contracts';
export interface AdapterJob { invocationId: string; capabilityId: string; version: string; action: string; input: unknown; handle: CredentialHandle; mode: 'dry-run' | 'full'; timeoutMs: number; riskClass: RiskClass; executionEnvironment: string; moduleUrl: string; }
export type WorkerReply = { ok: true; output: unknown; logs: Array<{ level: string; msg: string; fields?: Record<string, unknown> }> } | { ok: false; error: string };
