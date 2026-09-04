# MK.42 Foundation Review

Date: 2026-09-04  
Review basis: ASCENSION audit and the load-bearing Agency Plane implementation on `main`.

## Verdict

**CONDITIONAL GO for continued MK.42 hardening; NO-GO for distributed or autonomous deployment.** The running Kernel now owns the Agency Plane and has one authenticated proposal ingress. Registered capabilities execute through durable policy, permission, approval, credential, isolated adapter, verification, rollback, and audit controls. The remaining MK.43 blockers are the atomic start barrier, distributed token storage, broader observability, recovery drills, and Node Protocol enforcement.

## Scores

| Area | Score | Assessment |
|---|---:|---|
| Architecture compliance | 7/10 | Agency components are composed in `kernel.ts`; agents and desktop cannot import adapters; UI is not authority. |
| Security | 6/10 | Fail-closed policy, grants, approval expiry/resume, scoped one-use authority tokens, no-secret handles, and independent verification are enforced. Node identity and production secret storage remain incomplete. |
| Resilience | 6/10 | PostgreSQL invocation history, proposal uniqueness, durable leases, replay-safe lifecycle events, verified rollback, and health recovery are present. Freshness/lease/start are not yet one transaction. |
| Observability | 3/10 | The complete agency lifecycle is durable and correlation-linked. OpenTelemetry spans and metrics are not yet complete across RTC, model, capability, and response. |

## Implemented Architecture

- `buildKernel` composes the PostgreSQL Capability Registry, Grant Store, Permission Manager, Approval Manager, Credential Broker, Executor, Invocation Store, resource lease manager, Adapter Host, and Verification Runner.
- `AgencyIngress` authenticates the caller and constructs the authoritative actor. The Executor is deliberately not exposed on `KernelHandle`.
- Capability definitions default to requiring wrapped credentials; no-credential providers must opt in explicitly.
- Capability and grant bootstrap records are durable. Proposal IDs are uniquely constrained in PostgreSQL and invocation transitions are recorded in `agency.invocation_history`.
- Approval-required proposals stop in `AWAITING_APPROVAL`. An authenticated same-principal retry revalidates policy/input/constraints, consumes durable unexpired approval, and resumes the same invocation.
- Execution, pre-state capture, verification, and rollback use spawned Adapter Host workers. Adapter self-reports cannot establish success.
- Agency lifecycle events can only be emitted with the Executor source component and retain correlation/principal/actor context.
- JSONB persistence uses explicit JSON encoding, rejected events are durably observed before returning, outbox scheduling follows the event clock, and health listeners are awaited.

## Validation Run

| Gate | Result |
|---|---|
| `pnpm install` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS |
| `pnpm test` | PASS - 20 files, 107 tests |
| `pnpm test:integration` | PASS - 5 files, 30 tests, real PostgreSQL and spawned adapter workers |
| Architecture/security checks | PASS as part of `pnpm test` |

The integration suite proves rejection of unregistered and policy-denied capabilities, grant enforcement, approval enforcement and expiry, credential failure closure, isolated execution, independent verification, false-success prevention, verified compensation, proposal durability, and correlated lifecycle audit.

## Performance Assessment

No runtime performance certification is claimed. The full integration gate took approximately 198 seconds on the review machine, dominated by database-backed lifecycle tests. Hand, voice, UI, model, and semantic-vision latency budgets still require dedicated benchmark harnesses.

## Technical Debt and Known Risks

- Grant freshness, resource lease acquisition, and the `EXECUTING` transition are durable but not a single PostgreSQL transaction. A narrow revocation race remains.
- Authority tokens and credential handles are process-local. Multi-Kernel operation requires a shared, atomic, single-use token backend and distributed broker design.
- Adapter workers are isolated processes, not a hardened OS sandbox. Filesystem/network/process restrictions still depend on provider implementation and host controls.
- Credential material storage remains an injected interface; production keychain/KMS integration and ACL validation are not complete.
- The policy context still has provisional values for operator reachability, node trust, and authentication evidence until Node Protocol/session trust is enforced.
- OpenTelemetry, rate limits, bounded agency queues, circuit breakers, chaos coverage, backup/restore drills, and performance regression gates remain incomplete.
- Simulation remains fail-closed where a distinct dry-run authority flow is unavailable.

## Required Fixes Before MK.43

1. Make grant freshness, resource lease acquisition, and execution-start recording one atomic transaction.
2. Add shared single-use authority-token storage and production credential material integration.
3. Complete Node Protocol identity, enrollment, revocation, trust, and authenticated session continuity.
4. Add end-to-end OpenTelemetry spans/metrics and explicit backpressure/rate limits.
5. Add contract, chaos, recovery, backup/restore, and performance gates to CI.
6. Run the traced office-fix scenario across real RTC, context, agent, and response planes.

## Things We Should Deliberately NOT Build Yet

- More capability/model providers or autonomous objectives.
- Microservice extraction of the Kernel modular monolith.
- A distributed node mesh, robotics, or environmental control before node trust and revocation are enforced.
- UI spectacle presented as proof of Kernel authority.
- Exact MK.100 capabilities.
