# ADR-0034: `REQUIRE_APPROVAL` never auto-approves; approval is a real operator act on a trusted surface; timeout and unreachability fail closed; dual control requires two distinct acts

Status: Accepted
Date: 2026-09-03
Deciders: External Principal Architect (ASCENSION Stage A audit), Principal (rhyslacy123)
Relates-to: ADR-0027 (approval workflow, dual control), ADR-0019 (modes), SECURITY_MODEL §7, FAILURE_MODEL §4; corrects the as-built `executor.ts`

## Context

`executor.ts` currently does:

```ts
if (policy.verdict === 'REQUIRE_APPROVAL') await this.transition(id, 'AWAITING_APPROVAL', 'awaiting_approval');
await this.transition(id, 'APPROVED', 'approved');
```

— it enters `AWAITING_APPROVAL` and unconditionally leaves for `APPROVED`.
There is no `ApprovalRequest`, no Notification surface, no timeout, no
`mayProceedWithoutLiveApproval` gate, no confirmation phrase, no consumption of
`requiredAuthorisations`. The correct pure `approvalReducer` and
`PermissionManager.requiredAuthorisations` exist in `@jarvis/permissions` and
are called by nothing. `LEGAL_INVOCATION_TRANSITIONS` even permits
`POLICY_CHECKED → APPROVED` directly, which is what lets the auto-approve pass
the lifecycle guard. See `AUDIT_MK42_ASCENSION.md` F-AG-2, C7.

The result: a CRITICAL action (financial transfer, production drop, robotics
motion) flowing into this Executor is auto-approved, and "operator unreachable
⇒ fail closed" is inverted to "operator absent ⇒ proceed". This contradicts
L19, ADR-0027, SECURITY_MODEL §7, FAILURE_MODEL §4.

## Decision

### 1. The lifecycle forbids the shortcut

`LEGAL_INVOCATION_TRANSITIONS` is amended:

- `POLICY_CHECKED`: `['AWAITING_APPROVAL', 'APPROVED', 'DENIED']` →
  `['AWAITING_APPROVAL', 'APPROVED', 'DENIED']` **but** the Executor may only
  emit `POLICY_CHECKED → APPROVED` when `policy.verdict === 'ALLOW'` **and** the
  action is not CRITICAL **and** the capability is not probationary. Any
  `REQUIRE_APPROVAL`, CRITICAL, or probationary invocation **must** pass
  through `AWAITING_APPROVAL`, and `AWAITING_APPROVAL → APPROVED` requires a
  recorded `ApprovalRequest` in state `approved` (§2).
- A fitness test (ADR-0038) asserts no Executor code path reaches `EXECUTING`
  for a `REQUIRE_APPROVAL` invocation without an `agency.approvals` row in
  `approved`.

### 2. `AWAITING_APPROVAL` creates a real `ApprovalRequest` and blocks

On `REQUIRE_APPROVAL` (or CRITICAL / probationary):

1. The Permission Engine writes `agency.approvals` (`pending`,
   `required_authorisations = 2` for CRITICAL else `1`), with the
   `PredictedEffect` (ADR-0032 §2) for `riskClass >= HIGH`.
2. The Notification Manager surfaces it on a **trusted surface only**:
   `hostTrustTier ∈ {kernel-local, owned-secure}`, operator identity,
   `authTrustLevel >= trusted` (`verified` for CRITICAL).
3. The invocation **does not advance**. The Executor returns a pending
   `InvocationResult` (`outcome: 'awaiting_approval'`); the caller learns the
   outcome later from the ledger event, not a blocked call.
4. Operator actions: `approve`, `reject`, `edit-then-approve` (an edit rewrites
   `input` and the invocation **re-enters Validator → Policy from the top** —
   the edited invocation is a new proposal with the same `correlationId`).

### 3. Timeout and unreachability fail closed

- Default approval TTL 15 min (per-capability override allowed, downward only).
- On TTL expiry **or** no trusted surface reachable to display the request ⇒
  `agency.approvals` → `expired` ⇒ invocation → `DENIED`, queued not executed.
- The **only** exception: the driving grant carries
  `mayProceedWithoutLiveApproval = true` for a scope covering the action **and**
  `riskClass <= grant.maxRiskWithoutLiveApproval`. Then ⇒ `APPROVED` with
  `approval_evidence.kind = 'standing-grant'`, `grant_id` recorded. This is
  per-grant, per-scope, off by default, audited on grant issue, and listed in
  the effective-authority report (ADR-0027 risks).
- There is no other path from `AWAITING_APPROVAL` to `APPROVED`. No mode
  (`AUTONOMOUS` included) and no objective gate can create one (ADR-0019,
  restrict-only).

### 4. Dual control for CRITICAL — two distinct acts, one session, verified trust

`agency.approvals.required_authorisations = 2`. Approval reaches `approved` only
when `approvalReducer` has recorded **both**:

1. an `authorise` event (`kind: operator`) — the operator clicks approve on the
   `ApprovalRequest`; and
2. a `confirm` event (`kind: confirmation`) — a **separate** `Command`
   submitting a typed phrase whose hash matches the manifest's
   `confirmationPhrase` for that capability action.

Both must be from the **same `sessionId`**, at `authTrustLevel: verified`,
within the TTL. CRITICAL is **always** simulate-first; `simulatable: false`
CRITICAL surfaces "no simulation available" and still needs both acts. The
phrase hash is stored as `approval_evidence`. The `engine hard cap`
`GUARDIAN + CRITICAL ⇒ DENY` still applies before any of this.

### 5. Wiring

The Executor is constructed with a `PermissionEngine` that owns
`agency.approvals` and an injected `NotificationManager` handle. The
confirmation-phrase `Command` arrives through the same authenticated internal
ingress as proposals (ADR-0031 §3). `approvalReducer` is the state transition
function; `agency.approvals` is its projection.

## Alternatives considered

- **Keep auto-approve behind a config flag defaulting off.** Rejected — a
  security-critical default that can be flipped to unsafe by config is a
  latent L19 violation; SECURITY_MODEL forbids config from making policy
  non-deterministic or less safe.
- **Approve = one confirmation dialog with a checkbox.** Rejected by ADR-0027
  already (two clicks in one flow is one act).
- **Block the Executor call until the operator answers.** Rejected — a 15-min
  synchronous block ties up the pipeline; the invocation is durable (ADR-0033)
  and resumes from the approval event.

## Benefits

- CRITICAL cannot be reached by any single automated or accidental act.
- Operator-absent means the action waits or is denied — never proceeds.
- The approval is of a concrete predicted effect.

## Disadvantages

- The Executor's `invoke()` becomes asynchronous-with-later-outcome for
  approval-gated actions; callers must handle a pending result.
- Genuine CRITICAL actions carry real friction (a typed phrase). By design.

## Risks

- **Notification Manager cannot reach any trusted surface, so everything
  fails closed and JARVIS looks broken.** Accepted and correct — the operator
  fixes the surface; a `SECURITY` alert records the stuck approvals. Better
  than proceeding.
- **`mayProceedWithoutLiveApproval` becomes habitual.** Mitigated: per-scope,
  audited, in the effective-authority report, Sentinel flags a grant that has
  it set at `riskClass >= HIGH`.

## Consequences

- `contracts/src/agency.ts`: `LEGAL_INVOCATION_TRANSITIONS` amended;
  `InvocationResult.outcome` gains `'awaiting_approval'`.
- `executor.ts`: the unconditional `APPROVED` transition is removed; the
  approval branch creates/awaits an `agency.approvals` row.
- `permission/`: `approvalReducer` + `agency.approvals` projection wired;
  Notification Manager handle injected.
- `SECURITY_MODEL.md` §7, `FAILURE_MODEL.md` §4 move to `Enforcement: enforced`
  when the pipeline test lands.

## Reversal difficulty

**High.** This is the enforcement of L19. Additive fields (per-capability TTL
override) are Low.

## Implementation note — 2026-09-04

An approval is now durably bound to principal, invocation, capability and
version, action, canonical input hash, risk, expiry, random nonce, and
optimistic version. Approval updates compare version and expiry atomically.
Resume recomputes the input hash and re-runs validation, policy, constraints,
and grant freshness. A changed argument, stale nonce/version, expired row, or
different principal fails closed.
