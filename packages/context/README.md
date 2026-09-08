# @jarvis/context

> **Status — IMPLEMENTED in the Kernel.** The Context Compiler runs at
> `apps/core/src/kernel/context/` (`ContextCompiler`, `ranking.ts`). This
> package is a README-only pointer.

**Purpose.** The **Context Compiler** (`docs/architecture/COGNITION_MODEL.md`
§4, `KERNEL_CONSTITUTION.md` #5). Assembles a bounded, ranked, privacy-filtered,
deduplicated, versioned `ContextPackage` from:

- authoritative Kernel state slices
- recent events (bounded)
- registered capability names
- **ATLAS** (MK.46): entities, relationships, facts, observations, conflicts,
  causal hypotheses — via `AtlasQuery` + `AtlasStore` read paths
- **MNEMOSYNE** (MK.46): episodes, semantic, procedures, preferences — via
  `MemoryRecall` (seven-factor composite)

It is the **only** place ATLAS and MNEMOSYNE are fused (ADR-0020); each is
queried directly, never through the other. Every item carries `provenance`,
`privacyClass`, `sourceType`, and (where the source has one) `confidence`. The
package exposes `maxPrivacyClass` so cognition can route model locality without
loosening any label.

**Must not.** Call a model. Produce an unbounded package. Emit "chat messages".
Write any store.
