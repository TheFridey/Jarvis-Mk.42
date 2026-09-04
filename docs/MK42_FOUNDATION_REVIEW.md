# MK.42 Foundation Review

Date: 2026-09-04  
Review basis: ASCENSION audit and the load-bearing Agency Plane implementation on `main`.

## Verdict

**CONDITIONAL GO for continued MK.42 hardening; NO-GO for distributed or autonomous deployment.** The running Kernel owns the Agency Plane and PostgreSQL retains invocation, approval, grant, authority-token and execution-lease truth across restart. Mandatory repository gates, a disposable-database restore drill, and deterministic failure simulations now run locally and in CI. Remaining blockers include hardened worker isolation, broader observability, production backup operations, and Node Protocol enforcement.

## Scores

| Area | Score | Assessment |
|---|---:|---|
| Architecture compliance | 7/10 | Agency components are composed in `kernel.ts`; agents and desktop cannot import adapters; UI is not authority. |
| Security | 6/10 | Fail-closed policy, grants, approval expiry/resume, scoped one-use authority tokens, no-secret handles, and independent verification are enforced. Node identity and production secret storage remain incomplete. |
| Resilience | 7/10 | PostgreSQL lifecycle truth, proposal uniqueness, owner/heartbeat leases, expired takeover, restart classification, replay separation, verified rollback, health recovery, chaos simulations, and a schema restore drill are present. |
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
| `pnpm test:integration` | PASS - 7 files, 45 tests, disposable PostgreSQL and spawned adapter workers |
| `pnpm test:contract` | PASS - 10 versioned boundary contracts |
| `pnpm test:security` | PASS - 17 adversarial security cases |
| `pnpm fitness` | PASS - 14 prohibited-dependency and authority checks |
| `pnpm test:chaos` | PASS - 10 deterministic failure simulations |
| `pnpm backup:drill` | PASS - destructive restore of six authoritative data classes in disposable PostgreSQL |
| `pnpm verify:full` | Mandatory aggregate gate; runs every item above |

The integration suite proves rejection of unregistered and policy-denied capabilities, grant enforcement, approval enforcement and expiry, credential failure closure, isolated execution, independent verification, false-success prevention, verified compensation, proposal durability, and correlated lifecycle audit.

## Performance Assessment

No runtime performance certification is claimed. Integration tests use one isolated PostgreSQL container per suite. Linux CI uses two workers; Windows defaults to one because Docker Desktop resource contention can otherwise dominate query latency. Hand, voice, UI, model, and semantic-vision latency budgets still require dedicated benchmark harnesses.

## Technical Debt and Known Risks

- Grant freshness, execution lease acquisition, attempt increment, and `LEASE_ACQUIRED` are one transaction. The audit event and subsequent `EXECUTING` transition intentionally follow; a crash there is classified on restart without re-execution.
- Authority tokens are hashed, durable, and atomically single-use. Redeemable credential handles remain deliberately process-local while their lease references are durable.
- Adapter workers are isolated processes, not a hardened OS sandbox. Filesystem/network/process restrictions still depend on provider implementation and host controls.
- Credential material storage remains an injected interface; production keychain/KMS integration and ACL validation are not complete.
- The policy context still has provisional values for operator reachability, node trust, and authentication evidence until Node Protocol/session trust is enforced.
- OpenTelemetry, rate limits, bounded agency queues, circuit breakers, production backup automation, hardware fault injection, and performance regression gates remain incomplete. The chaos gate is deterministic simulation, not hardware certification.
- Simulation remains fail-closed where a distinct dry-run authority flow is unavailable.

## Required Fixes Before MK.43

1. Add production credential material integration and hardened worker sandboxing.
2. Add a recovery worker that executes and independently verifies durable `ROLLBACK_PENDING` compensation jobs; cold start currently classifies and queues them safely.
3. Complete Node Protocol identity, enrollment, revocation, trust, and authenticated session continuity.
4. Add end-to-end OpenTelemetry spans/metrics and explicit backpressure/rate limits.
5. Add measurable performance regression gates and validate the backup procedure against production-equivalent encrypted storage.
6. Run the traced office-fix scenario across real RTC, context, agent, and response planes.

## Things We Should Deliberately NOT Build Yet

- More capability/model providers or autonomous objectives.
- Microservice extraction of the Kernel modular monolith.
- A distributed node mesh, robotics, or environmental control before node trust and revocation are enforced.
- UI spectacle presented as proof of Kernel authority.
- Exact MK.100 capabilities.
