# apps/diagnostics — operator diagnostics

A **read-only** operator UI over Kernel APIs. Deployed independently so it can
inspect a Kernel that is degraded or mid-incident.

## Shows

- Live event stream + filter by `correlationId` / `subject` / `type`.
- Audit traces: for any effect — who proposed it, which context/evidence, which
  policy rule fired, who approved, what was simulated, what `verify` found,
  whether it rolled back (`SECURITY_MODEL.md` §8).
- Health Manager degradation state, per-component/node/dependency.
- Pending approvals (view only; approving happens on a trusted Experience
  surface).
- Projection lag, outbox depth, JetStream consumer state.
- Objective tree + status history.

## Must not

Mutate anything. Approve actions. Hold any store credential beyond a scoped
read token.

## Depends on

`@jarvis/sdk` (read side), `@jarvis/contracts`. NestJS backend-for-frontend +
React.
