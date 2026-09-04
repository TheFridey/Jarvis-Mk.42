/**
 * Proposal — typed cognition output. NEVER an effect (L21, ADR-0018).
 *
 * Governance: docs/architecture/COGNITION_MODEL.md §5
 *
 * A Proposal is UNTRUSTED until the Validator passes it. A proposed capability
 * invocation re-enters the full Executor pipeline; cognition cannot skip a
 * stage. An LLM may emit a PolicyRecommendation but the Policy Engine treats it
 * as ONE input, never the verdict.
 */

import type { CorrelationId } from './common.ts';
import type { Provenance } from './provenance.ts';

export type ProposalKind =
  | 'answer'
  | 'plan'
  | 'draft'
  | 'fact_extraction'
  | 'policy_recommendation'
  | 'capability_invocation'
  | 'capability_draft'
  | 'clarification_request';

interface ProposalBase {
  /** Stable caller-generated id. Retries with the same id must not re-execute. */
  proposalId: string;
  kind: ProposalKind;
  provenance: Provenance; // carries derivedFromUntrusted
  correlationId: CorrelationId;
  /** Cognition's own confidence in this proposal, 0..1. */
  confidence: number;
}

export interface AnswerProposal extends ProposalBase {
  kind: 'answer';
  text: string;
  citations: string[];
}

export interface PlanStep {
  ordinal: number;
  intent: string;
  /** If this step wants an effect, the capability it proposes to invoke. */
  proposedInvocation?: ProposedInvocation;
  preconditions: string[];
  expectedEffect: string;
}

export interface PlanProposal extends ProposalBase {
  kind: 'plan';
  goal: string;
  steps: PlanStep[];
}

export interface DraftProposal extends ProposalBase {
  kind: 'draft';
  artifact: string;
  mimeType: string;
}

export interface FactExtractionProposal extends ProposalBase {
  kind: 'fact_extraction';
  /** Candidate facts for World Model ingestion; ingestion re-validates. */
  candidates: Array<{
    subjectHint: string;
    attribute: string;
    value: unknown;
    confidence: number;
  }>;
}

export type PolicyVerdict = 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL';

export interface PolicyRecommendationProposal extends ProposalBase {
  kind: 'policy_recommendation';
  recommendation: PolicyVerdict;
  reasoning: string;
}

export interface ProposedInvocation {
  capabilityId: string;
  capabilityVersion: string;
  action: string;
  input: unknown;
}

export interface CapabilityInvocationProposal extends ProposalBase {
  kind: 'capability_invocation';
  invocation: ProposedInvocation;
  justification: string;
}

export interface ClarificationRequestProposal extends ProposalBase {
  kind: 'clarification_request';
  question: string;
  options?: string[];
}

export interface CapabilityDraftProposal extends ProposalBase {
  kind: 'capability_draft';
  manifest: unknown;
  adapterSource: string;
  testSource: string;
  researchNotes: string;
  declaredEgress: string[];
}

export type Proposal =
  | AnswerProposal
  | PlanProposal
  | DraftProposal
  | FactExtractionProposal
  | PolicyRecommendationProposal
  | CapabilityInvocationProposal
  | CapabilityDraftProposal
  | ClarificationRequestProposal;

/** Result of running a Proposal through the Validator (packages/validation). */
export interface ValidationResult {
  ok: boolean;
  /** Present when ok = false. */
  rejections?: Array<{ code: string; detail: string }>;
  /** Propagated onto any downstream effect / fact. */
  derivedFromUntrusted: boolean;
}
