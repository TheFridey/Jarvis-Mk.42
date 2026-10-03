import type { AgentManifest } from '@jarvis/contracts';

export function proposalInstructions(manifest: AgentManifest, correlationId: string, at: string): string {
  const fields: Record<string, object> = {
    answer: { text: 'Your answer', citations: [] },
    clarification_request: { question: 'Your clarification question', options: [] },
    plan: { goal: 'Proposed goal', steps: [] },
    draft: { artifact: 'Draft content', mimeType: 'text/plain' },
    fact_extraction: { candidates: [] },
    capability_invocation: { invocation: { capabilityId: 'an allowed capability ID', capabilityVersion: 'its registered version', action: 'allowed action', input: {} }, justification: 'Evidence for this proposal' },
    policy_recommendation: { recommendation: 'REQUIRE_APPROVAL', reasoning: 'Evidence for recommendation' },
    capability_draft: { manifest: {}, adapterSource: '', testSource: '', researchNotes: '', declaredEgress: [] },
  };
  const examples = manifest.proposalScope.kinds.map(kind => ({
    proposalId: 'unique-id-within-this-response', kind, correlationId, confidence: 0.5,
    provenance: { method: 'model', producedBy: manifest.id, producedOn: 'model-gateway', producedAt: at, correlationId, derivedFromUntrusted: true },
    ...fields[kind],
  }));
  return `Return a JSON object with exactly the envelope {"proposals":[...],"evidence":[]}. No markdown fences or text outside JSON. Every proposal requires all common fields shown below and the fields for its kind. Examples are field templates, not facts or permission grants; replace placeholder content with your actual answer. Use only kinds and capability IDs allowed by the specialist scope. For an ordinary question use an answer proposal, including text and citations (empty when no sources). Templates: ${JSON.stringify(examples)}`;
}
