/**
 * @jarvis/contracts - shared, provider-neutral type contracts for the JARVIS
 * Kernel. Types + trivial lookup tables only. Zero runtime behaviour. Leaf of
 * the dependency graph (ADR-0007).
 *
 * Subordinate to docs/architecture/PRINCIPLES.md; evolves additively
 * (ROADMAP.md "The invariant"). Breaking changes require an ADR.
 */

export * from './common.ts';
export * from './provenance.ts';
export * from './embedding.ts';
export * from './event.ts';
export * from './event-names.ts';
export * from './entity.ts';
export * from './fact.ts';
export * from './observation.ts';
export * from './causal.ts';
export * from './context-frame.ts';
export * from './context.ts';
export * from './proposal.ts';
export * from './capability.ts';
export * from './policy.ts';
export * from './permission.ts';
export * from './agency.ts';
export * from './agent-result.ts';
export * from './cognition.ts';
export * from './voice.ts';
export * from './vision.ts';
export * from './objective.ts';
export * from './model.ts';
export * from './node.ts';
export * from './audit.ts';

// --- Nervous System (MK.43) ---
export * from './mode.ts';
export * from './identity.ts';
export * from './session.ts';
export * from './presence.ts';
export * from './health.ts';
export * from './scheduler.ts';
export * from './notification.ts';
export * from './state.ts';
export * from './diagnostics.ts';

// --- Knowledge (MK.46) ---
// `Episode` is re-exported as `MemoryEpisode` to avoid colliding with the
// ContextFrame `Episode` in context-frame.ts. Import from './memory.ts' directly
// for the unaliased name.
export type { MemoryClass, Episode as MemoryEpisode, SemanticMemory, ProcedureStep, Procedure, Preference } from './memory.ts';
export * from './memory-candidate.ts';
export * from './memory-insight.ts';
export * from './knowledge-ingestion.ts';
export * from './atlas-query.ts';
export * from './memory-recall.ts';
export * from './knowledge-agent.ts';
export * from './business.ts';
export * from './companion.ts';
