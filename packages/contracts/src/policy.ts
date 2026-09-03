/**
 * Policy — the deterministic decision layer (L20, L21).
 *
 * Governance: docs/architecture/SECURITY_MODEL.md §3
 *
 * The Policy Engine is a PURE function of typed inputs: no network, no model
 * calls, no side effects. Same inputs => same decision. An LLM
 * PolicyRecommendation may appear as ONE typed input to a rule, but a rule can
 * never be "return whatever the model said" (L21).
 */

import type { PrincipalId, Timestamp } from './common.ts';
import type { EventLocation } from './event.ts';
import type { PolicyVerdict } from './proposal.ts';
import type { RiskClass } from './capability.ts';

export interface PolicyActor {
  kind: 'principal' | 'agent';
  id: string;
  onBehalfOf: PrincipalId;
  /** Scopes currently held via active grants. */
  heldScopes: string[];
}

export interface PolicyContext {
  /** Is a trusted approval surface currently reachable? */
  operatorReachable: boolean;
  /** Health Manager degradation level gates behaviour. */
  degradation: 'nominal' | 'degraded' | 'critical';
  /** True if the driving evidence chain includes untrusted content. */
  derivedFromUntrusted: boolean;
  /** Node trust tier that would host the effect. */
  hostTrustTier: string;
  /** Optional advisory input; never dispositive on its own. */
  llmRecommendation?: PolicyVerdict;
  now: Timestamp;
  resourceRef: string;
  originNodeId: string;
  location?: EventLocation;
  authTrustLevel: 'untrusted' | 'provisional' | 'trusted' | 'verified';
  authMethod: string;
  jarvisMode: string;
  sessionId?: string;
  activeObjectiveGate?: 'autonomous' | 'conditional' | 'approval' | 'hard_confirmation';
  recentDenialCount: number;
}

export interface PolicyQuery {
  actor: PolicyActor;
  action: {
    capabilityId: string;
    action: string;
    riskClass: RiskClass;
    requiredScopes: string[];
  };
  context: PolicyContext;
}

export interface PolicyDecision {
  verdict: PolicyVerdict;
  /** Ids of the rules that fired, for audit (L31). */
  firedRuleIds: string[];
  /** Deterministic explanation string. */
  rationale: string;
}

/** A stored, versioned rule. Rules are DATA (PG policy.rules). */
export interface PolicyRule {
  id: string;
  version: number;
  description: string;
  /**
   * Serialised predicate over PolicyQuery. The engine evaluates it
   * deterministically. (Concrete DSL/AST defined by packages/permissions.)
   */
  predicate: PolicyPredicate;
  effect: PolicyVerdict;
  /** Higher priority wins on conflict; DENY always beats ALLOW at equal rank. */
  priority: number;
  enabled: boolean;
}

export type PolicyPredicate =
  | { op: 'and' | 'or'; args: PolicyPredicate[] }
  | { op: 'not'; arg: PolicyPredicate }
  | { op: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte'; path: string; value: unknown }
  | { op: 'in' | 'not-in'; path: string; values: unknown[] }
  | { op: 'matches'; path: string; pattern: string }
  | { op: 'path-under'; path: string; prefix: string }
  | { op: 'time-window'; tz: string; windows: Array<{ dow: number[]; from: string; to: string }> }
  | { op: 'scope-held'; scope: string }
  | { op: 'risk-at-least'; class: RiskClass };
