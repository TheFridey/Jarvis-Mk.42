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
  context: ContextFrame;
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
