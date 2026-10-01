# @jarvis/kernel

> **README-ONLY ARCHITECTURAL SEAM — NOT A WORKSPACE PACKAGE.** The real
> composition root is `apps/core/src/kernel/lifecycle/kernel.ts`, and component
> implementations live under `apps/core/src/kernel/*`. This directory does not
> define a second framework or Kernel component.

**Purpose.** The Kernel module framework — component base classes, the port
(service-interface) definitions each of the 16 Kernel components implements, and
the composition root that `apps/core` wires together. It encodes the structural
rules of `docs/architecture/KERNEL_CONSTITUTION.md` as code (dependency
direction, event-contribution registration, per-schema DB role binding).

**Owns.** No state, no domain logic. Only the wiring contracts and shared
scaffolding.

**Depends on.** `@jarvis/contracts` only.

**Must not.** Contain any component's business logic (that lives in
`@jarvis/events`, `@jarvis/state`, `@jarvis/permissions`, …). Import a provider
SDK or a capability adapter. Allow a component module to declare a dependency
that violates the ingress → sense-making → intent → authority → catalogues →
orchestration direction.

**Extraction seam.** n/a — it is the framework that *defines* the seams.
