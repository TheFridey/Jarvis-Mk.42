/**
 * Model Gateway contracts — provider-neutral (L1, L3, L26).
 *
 * Governance: docs/architecture/COGNITION_MODEL.md §2, ADR-0010
 *
 * NO provider "chat" shape appears here (review §16.6). `input` is structured;
 * the gateway adapter serialises it to whatever the chosen provider wants.
 * Budgets are in abstract "context units" mapped by the adapter to a
 * provider tokenizer.
 */

import type { CorrelationId, PrincipalId, Timestamp } from './common.ts';
import type { ContextFrame } from './context-frame.ts';
import type { ContextPackage } from './context.ts';
import type { PrivacyClass } from './event.ts';
import type { Provenance } from './provenance.ts';

export type ModelTask =
  | 'reason'
  | 'plan'
  | 'summarize'
  | 'extract'
  | 'classify'
  | 'code'
  | 'embed'
  | 'transcribe'
  | 'vision';

export type ModelCapability =
  | 'tools'
  | 'vision'
  | 'json'
  | 'long_context'
  | 'streaming'
  | 'function_calling';

export type Locality = 'local' | 'prefer-local' | 'any' | 'cloud-ok';

export interface ModelInput {
  instruction: string;
  context: ContextFrame | ContextPackage;
  constraints: string[];
  examples?: Array<{ input: string; output: string }>;
}

export interface ModelRequest {
  task: ModelTask;
  capabilities: ModelCapability[];
  input: ModelInput;
  budget: {
    contextUnits: number;
    maxOutput: number;
    maxCost?: number;
    maxLatencyMs?: number;
  };
  locality: Locality;
  determinism?: 'strict' | 'low-temp' | 'creative';
  /** Opt-in only; TTL'd; content otherwise not persisted. */
  cacheable?: boolean;
  correlationId: CorrelationId;
  principalId: PrincipalId;
  privacyClass?: PrivacyClass;
  realtime?: boolean;
  toolRequirements?: string[];
  preferredModels?: string[];
}

export type FinishReason = 'stop' | 'length' | 'filtered' | 'error';

export interface ModelResponse {
  modelId: string;
  output: unknown;
  usage: {
    contextUnits: number;
    outputUnits: number;
    costEstimate: number;
    latencyMs: number;
  };
  finishReason: FinishReason;
  provenance: Provenance;
}

export type ModelErrorCode = 'NO_ROUTE' | 'UNAVAILABLE' | 'TIMEOUT' | 'CANCELLED' | 'RATE_LIMITED' | 'AUTHENTICATION' | 'INVALID_RESPONSE' | 'PROVIDER_ERROR' | 'BUDGET_EXCEEDED';
export class ModelGatewayError extends Error { constructor(readonly code: ModelErrorCode, message: string, readonly retryable: boolean, readonly provider?: string) { super(message); this.name = 'ModelGatewayError'; } }
export interface ModelStreamChunk { type: 'delta' | 'usage' | 'done'; delta?: string; usage?: ModelResponse['usage']; response?: ModelResponse; }
export interface ModelHealth { modelId: string; provider: string; status: 'healthy' | 'degraded' | 'offline' | 'circuit-open'; checkedAt: Timestamp; latencyMs?: number; detail?: string; }

/** A registered model in the Kernel Model Registry (catalogue.models). */
export interface ModelRegistration {
  id: string;
  provider: string;
  displayName: string;
  tasks: ModelTask[];
  capabilities: ModelCapability[];
  contextLimitUnits: number;
  costPerContextUnit: number;
  costPerOutputUnit: number;
  locality: Extract<Locality, 'local' | 'cloud-ok'>;
  enabled: boolean;
  registeredAt: Timestamp;
}
