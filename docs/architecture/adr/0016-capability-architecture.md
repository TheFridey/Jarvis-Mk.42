# ADR-0016: Capability manifests + a single Executor

Status: Accepted
Date: 2026-08-31
Deciders: Principal Architect

## Context
L18–L24: every consequential action is permissioned, risk-tiered, verified,
and (when dangerous) simulated and reversible. L28–L29: new capabilities must
extend JARVIS without mutating the protected Kernel. L30: security is
architectural. We must prevent (a) effects that bypass policy, (b) the Kernel
growing code per tool, (c) adapters holding broad credentials, (d) "assumed
success".

## Decision
- A **capability** is a versioned **manifest** (`packages/contracts/src/
  capability.ts`): actions with input/output schemas, `riskClass`,
  `reversible`/`rollback`, `simulate`/`simulatable`, mandatory `verify`,
  `requiredScopes`, `resourceKey`, `trustTierMin`, optional multi-step `steps`
  with per-step `verify`/`compensate`.
- Manifests are registered in the Kernel **Capability Registry** (data). The
  Kernel binary does not change to add a capability (L28).
- **Adapters** implement manifests and run **out-of-process**, on the node
  where the resource lives, holding only their own scoped resource credential.
- **One Capability Executor** is the sole path to any effect
  (`AGENCY_MODEL.md` §3): Validator → Policy Engine → Permission Engine →
  freshness barrier + `capability.started` → resource lease → simulate (if
  `riskClass >= HIGH`) → execute → `verify` → emit result → rollback/compensate
  on failure. Every stage emits a ledger event.
- Cognition, agents, interfaces, and the Objective Engine **propose**
  invocations; only the Executor executes.

## Alternatives considered
- **Tools as plugins loaded into the Kernel process** — fast calls, but code
  in the protected process per tool (violates L28/L29) and shared failure
  domain.
- **Let agents call tools directly (typical "agent framework")** — the
  spaghetti and authority-leak the constitution forbids (L10, L18). Rejected.
- **Per-capability bespoke permission logic** — inconsistent enforcement,
  impossible to audit uniformly. The single Executor + deterministic Policy
  Engine is the point.
- **No mandatory verify (trust adapter return codes)** — violates L22; a
  common source of silent partial failure.

## Benefits
- Uniform, auditable enforcement of policy, permission, simulation,
  verification, and rollback for every effect.
- Adding a tool is data + an isolated adapter; the Kernel is untouched.
- Blast radius of a buggy/compromised adapter is one out-of-process invocation
  with a scoped credential and a lease.
- Partial-execution recovery is systematic (saga compensation on restart).

## Disadvantages
- More moving parts per action than a direct function call (process spawn/pool,
  IPC, verify step).
- Manifest authoring discipline: every action must define `verify` and
  (if reversible) `rollback`/`compensate`.
- Simulation requires adapters to support a dry-run mode or honestly declare
  they can't.

## Risks
- Latency from the pipeline for trivial actions. Mitigated: AMBIENT/LOW reads
  skip simulation and use standing grants; adapters can be pooled.
- Adapters that fake `simulate` or skip `verify`. Mitigated: the Executor
  injects the dry-run credential scope (a faked simulate has no real access);
  `verify` is invoked by the Executor, not self-reported.

## Consequences
- `capabilities/*` contains manifests; adapters are separate binaries/workers.
- No code path to an effect exists outside the Executor — enforced by
  credential partitioning (adapters are unreachable except via the Executor
  channel).
- Robotics/smart-home (L38) are just CRITICAL-heavy manifests on a new node;
  no new mechanism.

## Reversal difficulty
**High.** The Executor pipeline and manifest model are load-bearing for
L18–L24 and L28–L30. Changing the model means re-doing enforcement for every
capability. Individual manifest fields can evolve additively (Low); the
pipeline shape cannot change cheaply.
