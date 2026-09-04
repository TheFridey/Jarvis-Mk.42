import type { Capability } from '@jarvis/contracts'; import type { CapabilityRegistry } from './registry.ts';
export interface SignedPromotion { actorId: string; authTrustLevel: string; signature: string; }
export async function promoteCapability(registry: CapabilityRegistry, manifest: Capability, artifactHash: string, approval: SignedPromotion) {
  if (approval.authTrustLevel !== 'verified' || !approval.signature) return { ok: false as const, reason: 'verified operator approval required' };
  const registered = await registry.register(manifest, artifactHash, approval.actorId); if (!registered.ok) return { ok: false as const, reason: registered.detail };
  await registry.enterProbation(manifest.id); return { ok: true as const, capabilityId: manifest.id };
}
