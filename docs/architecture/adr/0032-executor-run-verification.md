# ADR-0032: Verification and simulation are Executor-run against the world; rollback is itself verified

Status: Accepted
Date: 2026-09-03
Deciders: External Principal Architect (ASCENSION Stage A audit), Principal (rhyslacy123)
Relates-to: ADR-0016, ADR-0025; corrects the as-built `verify-runner.ts`

## Context

`AGENCY_MODEL.md` §10, L22, and threat-model T27 require that `verify` runs
**from the Executor against the world under a read-only credential**, and that
the adapter's `execute` return value is a debug field only. The as-built
`verify-runner.ts` is:

```ts
export function runVerification(adapter, action, ctx, input, output, strategy) {
  return adapter.verify(action, ctx, input, output, strategy);
}
```

— the same in-process adapter object verifies its own effect, with the same
full-credential context. `simulate` is called and its result discarded with no
approval gate (L24, `AGENCY_MODEL.md` §3). `rollback` is called once with no
re-verification of the undo (`RollbackReport.undone` unused; T26). See
`AUDIT_MK42_ASCENSION.md` F-AG-3, F-AG-4, F-RES-3.

Laws at stake: L22 (verify not assume), L23 (rollback defined and effective),
L24 (simulate dangerous first, present the predicted effect for approval).

## Decision

### 1. Verification is a distinct Executor step with its own credential and its own strategy interpreter

- The Executor owns a `VerificationRunner` that **interprets the manifest
  `verificationStrategy`** — it does not delegate to the adapter's `verify`
  method for the verdict.
  - `world-read` / `state-echo` / `health-probe`: the runner invokes a
    **separate, read-only adapter action** (named by `adapterRef`) through the
    Adapter Host with a `mode: 'dry-run'` credential handle from the broker, in
    a **fresh worker**, and asserts the returned state against the expected
    value/hash.
  - `event-await`: the runner subscribes to the ledger for `eventType` matching
    `matchPath` within `timeoutMs`; no adapter call.
  - `hash-match`: the runner reads `ofPath` (via a read-only action) and
    compares to `expectPath`.
- The adapter's `execute` return value and any transport status code are
  recorded on the invocation row as `execute_result_debug` and **never**
  influence the transition to `COMPLETED`.
- A `verificationStrategy` that cannot be run (missing `adapterRef`, adapter
  offline, timeout) ⇒ `VERIFICATION_FAILED`, not `COMPLETED`. Fail closed.
- The verify worker gets a credential scoped `mode: 'dry-run'` and a
  capability/action pair whose manifest `riskClass` is `AMBIENT` or `LOW` (a
  read). Registration rejects a `verificationStrategy.adapterRef` pointing at a
  side-effecting action.

### 2. Simulation produces a `PredictedEffect` that is persisted and gates approval

For `riskClass >= HIGH` and `simulatable: true`:

1. Executor mints a `dry-run` credential, spawns a fresh worker, runs
   `adapter.simulate` ⇒ `PredictedEffect { summary, changes[] }`.
2. The `PredictedEffect` is written to `agency.invocations.predicted_effect_ref`
   (a blob/hash ref) and emitted on `jarvis.agency.invocation.simulated`.
3. If policy returned `REQUIRE_APPROVAL` (or the action is CRITICAL, or the
   capability is probationary), the `PredictedEffect` is attached to the
   `ApprovalRequest` surfaced to the operator (ADR-0034). Approval is of **the
   predicted effect**, not the abstract action.
4. `simulatable: false` at `riskClass >= HIGH` ⇒ the approval carries
   "no simulation available" and the required authority is escalated one tier
   (HIGH ⇒ treated as CRITICAL dual-control). The Executor never fabricates a
   `PredictedEffect`.

### 3. Rollback is a verified effect

- On post-execution verification failure of a `reversible` action, the Executor
  runs `adapter.rollback` **and then runs the action's `verificationStrategy`
  again** (or a declared `rollbackVerificationStrategy`) to confirm the world
  returned to the pre-execution state (`beforeStateRef`, captured before
  execute).
- `RollbackReport.undone === false` or residual items present ⇒
  `VERIFICATION_FAILED` **+** a `SECURITY`-class `jarvis.security.alert.critical`
  **+** a GUARDIAN-mode-transition recommendation. "Assumed undone" is removed
  as a code path.
- Multi-step actions (`steps[]`) use `saga-compensate`: each completed step's
  `compensate` runs in reverse, each is verified, and any un-compensated step
  yields `PARTIALLY_COMPLETED` + the same CRITICAL alert.

### 4. Pre-execution state capture

Before `EXECUTING`, for any `reversible` or `verificationStrategy: world-read`
action, the Executor captures `beforeStateRef` via a read-only action so that
verify and rollback have a baseline. Captured under a `dry-run` credential.

## Alternatives considered

- **Trust `adapter.verify` but require it to use a broker-supplied read-only
  credential.** Rejected — the adapter is the untrusted party; letting it
  self-report a verdict, even with a scoped credential, is the T27 hole.
- **Executor re-implements every provider's read path itself.** Rejected — that
  puts provider knowledge in the Kernel (L1). The read is a *separate manifest
  action* the Executor invokes; provider knowledge stays in the adapter.
- **Skip pre-state capture; rollback is best-effort.** Rejected — L23 requires
  rollback to be effective and verified, which needs a baseline.

## Benefits

- A compromised or buggy adapter cannot flip an invocation to `COMPLETED`.
- The operator approves a concrete predicted change, not a verb.
- A half-working undo is a CRITICAL incident, not a silent success.

## Disadvantages

- Two extra worker spawns per HIGH+ invocation (pre-state read, verify read),
  plus one for simulate — latency and memory cost (tens of ms each).
- Manifests must declare a read-only `adapterRef` for `world-read`/`hash-match`
  strategies; the SDK must generate a skeleton for it.

## Risks

- **The verify read action is itself subtly wrong (verifies the wrong thing).**
  Mitigated: registration requires the verify `adapterRef` to be
  `AMBIENT`/`LOW`, and the SDK testkit requires a test that verify fails when
  the effect is faked.
- **Latency pressure tempts skipping pre-state capture for "fast" HIGH
  actions.** Mitigated: the Executor has no branch that reaches `EXECUTING` for
  a `reversible` action without a `beforeStateRef`; the lifecycle guard
  (ADR-0033) enforces it.

## Consequences

- `apps/core/src/kernel/executor/verify-runner.ts` rewritten to an
  Executor-owned strategy interpreter; `adapter.verify` demoted to an optional
  adapter self-check recorded as debug only.
- `capability.ts`: `CapabilityAction` gains optional
  `rollbackVerificationStrategy`; registration validates verify `adapterRef`
  risk class.
- `agency.invocations`: `before_state_ref`, `predicted_effect_ref`,
  `execute_result_debug` columns are populated (they exist in `0008_agency.sql`).
- `AGENCY_MODEL.md` §10–§11 updated to the as-implemented flow;
  threat-model T26, T27 move to `Enforcement: enforced` only when the pipeline
  test exists.

## Reversal difficulty

**High.** Executor-run verification is the enforcement of L22; adapters and
manifests come to depend on the separate read action. Additive strategy kinds
are Low.
