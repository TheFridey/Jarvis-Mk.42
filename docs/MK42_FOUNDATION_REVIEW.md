# MK.42 Foundation Review

Date: 2026-09-04  
Review basis: ASCENSION Stage A audit at `53aa507` plus the Stage B hardening slice in the current worktree.

## Verdict

**NO-GO for MK.43.** The original 100-test baseline is now 105 passing unit tests and several critical unsafe defaults have been removed. The Agency Plane is still not wired into the Kernel composition root, is not PostgreSQL-backed, and does not execute through the Adapter Host. Those omissions prevent the repository from claiming a load-bearing safe-agency architecture.

## Architecture Compliance Score

| Area | Score | Evidence |
|---|---:|---|
| Design | 9/10 | Ratified model documents and ADRs 0031-0038 remain coherent. |
| As built | 5/10 | The MK.43 spine remains load-bearing. Executor pipeline tests now cover approval, independent verification, and proposal deduplication, but the pipeline remains unwired and in-memory. |

Moved from absent to **partial**:

- F-AG-2: `REQUIRE_APPROVAL` no longer auto-approves; the invocation returns `awaiting_approval` and does not execute. Durable approval rows, trusted-surface delivery, expiry, resume, and dual control remain required.
- F-AG-3: the completion verdict now comes from `VerificationRunner`, not `adapter.verify`. Fresh out-of-process read workers, event-ledger subscription, pre-state capture, and verified rollback remain required.
- F-AG-8: credential material now fails closed and minting consumes an invocation-bound authority token. File/keychain storage and worker-only wrapped-secret delivery remain required.
- F-RES-2: duplicate `proposalId` values return the existing invocation and canonical JSON is used for input/state hashes. PostgreSQL deduplication remains required.
- F-DATA-3: the Context Compiler now reads the newest bounded event window rather than the first events in the ledger.

## Security Score

**4/10.** The most immediately dangerous automatic approval, self-verification, and fabricated-secret paths are closed and covered by real Executor tests. Security remains non-load-bearing because the Kernel does not construct the Executor, adapters still have an in-process interface, grants/approvals are not durable, and Node Protocol trust enforcement is absent.

The threat model must continue to describe T16-T28 as `partial` or `design-only`; this review does not authorise an `enforced` label for the overall pipeline.

## Resilience Score

**5/10.** The transactional spine is unchanged and healthy. Proposal retries are idempotent within one process and context growth is bounded at the newest 20 events. Restart recovery, durable leases, approval resumption, circuit breakers, bounded agency queues, and chaos coverage are not implemented.

## Observability Score

**2/10.** No new OpenTelemetry SDK/provider or Executor span/metric coverage landed in this slice. Event correlation remains available in the spine, but an interaction cannot yet be reconstructed across RTC, cognition, agency, verification, and response.

## Performance Assessment

No performance certification was performed. The required benchmark harness, committed baseline, and regression comparison do not exist. Existing unit tests complete in approximately four seconds on the review machine; that is not a runtime performance result.

## Validation Run

| Gate | Result |
|---|---|
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS |
| `pnpm test` | PASS - 20 files, 105 tests |
| `pnpm test:integration` | FAIL - launcher repaired; Docker run exposed 11 failures, 1 pass, 17 skipped. Shared database truncation hit statement timeouts and PostgreSQL parameter encoding rejected object values in existing Event/State stores. |
| `pnpm test:contract` | BLOCKED - script/suite not implemented |
| `pnpm fitness` | BLOCKED - script/suite not implemented |
| `pnpm test:chaos` | BLOCKED - script/suite not implemented |
| restore drill | BLOCKED - script not implemented |
| `pnpm bench` | BLOCKED - script/harness not implemented |

## Technical Debt

- `InvocationStore`, grants, leases, and approvals remain process-local.
- Docker integration suites contend on shared database state and expose existing JSON parameter encoding failures; the integration gate is not green.
- Executor events still use the narrow `ExecutorEventSink`, not full `EventManager` envelopes.
- Adapter execution is not routed through a framed, isolated Adapter Host channel.
- Approval cannot yet be resumed by a separate authenticated operator act.
- Simulation has been changed to fail closed unless a distinct dry-run authority token path is supplied; the complete simulation/approval flow is not yet built.
- Rollback is not independently re-verified against captured pre-state.
- The new in-process proposal dedupe must become the `agency.proposal_dedupe` PostgreSQL constraint.

## Known Compromises

- The hardened Executor is directly tested but not part of the running Kernel.
- Credential material tests use an in-memory store; no production secrets-file ACL validation exists.
- Verification reads are abstracted behind an Executor-owned world interface, but the fresh-worker implementation is pending.
- Node identity, mTLS, attestation, revocation, and continuity are design-only.

## Known Risks

- Restart during an effect can lose lifecycle state and prevent compensation.
- Concurrent Kernel instances do not share resource leases or proposal deduplication.
- A compromised in-process adapter shares the Kernel blast radius.
- Existing architecture and threat-model prose can still be read as stronger than the running controls.
- No tested backup means World Model, memory, policies, permissions, objectives, procedures, audit history, and user artefacts remain exposed to disk loss.

## Deferred Work

- MK.43 blocker: complete H1-H5 from `HARDENING_SPEC_MK42.md`.
- MK.43 blocker: H12 contract and architecture-fitness gates.
- Before distribution: H7 Node Protocol and H8 composed offline/degradation behaviour.
- Before reliability certification: H9-H11 resilience, chaos, recovery, and performance harnesses.
- After the real pipeline exists: H13 traced office-fix scenario, with unavailable planes explicitly stubbed.

## Required Fixes Before MK.43

1. Wire the Registry, Policy, Permission, Executor, Broker, Adapter Host, Sentinel, and Guardian into `kernel.ts`.
2. Replace all agency `Map` authorities with PostgreSQL projections and implement the single-transaction freshness/lease/start barrier.
3. Implement durable approval requests, trusted-surface delivery, expiry, authenticated resume, and CRITICAL dual control.
4. Run execute, verify, and rollback in isolated workers; capture pre-state and independently verify rollback.
5. Add real credential storage and keep wrapped secrets outside Kernel memory.
6. Add contract and architecture-fitness suites and make them CI-blocking.
7. Implement and drill backup/restore before storing irreplaceable accumulated knowledge.

## Things We Should Deliberately NOT Build Yet

- More capability providers, agents, model providers, or desktop spectacle.
- Microservice extraction of the Kernel modular monolith.
- Autonomous objectives before durable permission, approval, execution, and recovery exist.
- Broad node mesh or robotics control before Node Protocol identity and revocation are enforced.
- Claimed end-to-end intelligence using canned telemetry or unlabelled stubs.
- Exact MK.100 capabilities.
