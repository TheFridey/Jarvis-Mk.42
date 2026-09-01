# ADR-0001: NestJS for the Kernel

Status: Accepted
Date: 2026-08-31
Deciders: Principal Architect

## Context
The Kernel (`apps/core`) is a long-lived modular monolith with ~16 components
that must have enforced internal boundaries (`KERNEL_CONSTITUTION.md`), clean
dependency injection, testability in isolation, and a structure that survives a
decade and later extraction into services (L40). TypeScript is the mandated
language. We need a framework that provides module boundaries, DI, lifecycle
hooks, and transport-agnostic messaging without imposing a specific runtime
coupling.

## Decision
Use **NestJS** as the application framework for `apps/core`, `apps/gateway`,
and `apps/diagnostics` (backend). Each Kernel component is a Nest module
exposing a provider interface and an event contribution; cross-module access is
only via injected interfaces or events. Nest's transport abstraction
(`@nestjs/microservices` custom transport over NATS) is the mechanism by which
an in-process module later becomes a service without consumer changes.

## Alternatives considered
- **Fastify + manual DI (e.g. awilix/tsyringe)** — lighter, but we rebuild
  module lifecycle, testing harness, and transport abstraction ourselves;
  boundary discipline becomes convention, not framework.
- **Encore.ts** — strong service model, but opinionated toward
  distribute-early and a hosted model; conflicts with modular-monolith-first
  (ADR-0008).
- **Effect / bare composition** — powerful, but a steep idiom for a
  ten-year team codebase; higher onboarding cost.
- **Moleculer** — service-broker-centric; pushes toward premature
  distribution.

## Benefits
- First-class module boundaries + DI match the constitution's structure.
- Mature testing story (per-module `Test.createTestingModule`) enables
  "understand and test each unit independently".
- Transport abstraction gives a real extraction seam (in-process ↔ NATS) with
  no consumer rewrite.
- Large ecosystem: OpenTelemetry, validation pipes, scheduling, health.
- Well-known idioms lower the cost of adding engineers over ten years.

## Disadvantages
- Decorator/metadata magic adds indirection and a learning curve.
- Startup reflection cost (negligible at our scale).
- Opinionated structure; fighting it is painful (we intend to follow it).

## Risks
- Framework stagnation or a breaking major version. Mitigated: Nest is widely
  adopted and our use is mostly DI + modules + a custom transport, the stable
  core.
- Teams over-using Nest features (e.g. request-scoped providers) in ways that
  hurt the long-lived-process model. Mitigated by lint rules + review.

## Consequences
- Kernel modules follow the Nest module pattern; each has a `*.module.ts`, a
  public provider interface, and its event types.
- The extraction path in `SYSTEM_BOUNDARIES.md` §10 assumes Nest custom
  transports.
- Perception processes (`apps/voice`, `apps/vision`) are **not** required to
  use Nest — they are realtime loops and may use minimal runtimes; they only
  depend on `packages/contracts` and a NATS client.

## Reversal difficulty
**Moderate.** Swapping the framework touches every Kernel module's wiring and
tests but not the contracts, the data model, the event schema, or business
logic organised behind interfaces. Estimated multi-week, mechanical.
