import type { AgentManifest, Capability } from '@jarvis/contracts';

/** What a specialist may see of a registered capability it is allowed to propose. Never a grant. */
export interface CapabilityContract { id: string; version: string; description: string; actions: Array<{ name: string; riskClass: string; input: unknown }>; }
export function capabilityContract(manifest: Capability): CapabilityContract {
  return { id: manifest.id, version: manifest.version, description: manifest.description, actions: manifest.actions.map(action => ({ name: action.name, riskClass: action.riskClass, input: action.inputSchema })) };
}

export function proposalInstructions(manifest: AgentManifest, correlationId: string, at: string, contracts: CapabilityContract[] = []): string {
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
  const allowed = manifest.proposalScope.kinds.includes('capability_invocation') ? contracts.filter(contract => manifest.proposalScope.capabilities.includes(contract.id)) : [];
  const capabilities = allowed.length ? ` Registered capabilities you may propose (use the exact capabilityId, capabilityVersion and action; input must match its schema): ${JSON.stringify(allowed)}. A capability_invocation is only a request: the Kernel validates it, applies policy, may require operator approval, then executes and verifies it later. Its result is NOT available in this response, so never state, guess or invent what it returns. When you propose one, also return an answer proposal telling the operator what you requested and why.` : '';
  return `Return a JSON object with exactly the envelope {"proposals":[...],"evidence":[]}. No markdown fences or text outside JSON. Every proposal requires all common fields shown below and the fields for its kind. Examples are field templates, not facts or permission grants; replace placeholder content with your actual answer. Use only kinds and capability IDs allowed by the specialist scope. For an ordinary question use an answer proposal, including text and citations (empty when no sources).${capabilities} Templates: ${JSON.stringify(examples)}`;
}
