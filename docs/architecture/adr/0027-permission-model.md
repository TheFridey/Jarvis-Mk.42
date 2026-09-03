# ADR-0027: Permission model — grants, constraints, authority tokens, freshness barrier, dual control

Status: Accepted
Date: 2026-09-03
Deciders: Principal Security Architect (Claude), Principal (rhyslacy123)

## Context

`permission.ts` declares `Grant`, `AuthorityToken`, `ApprovalRequest` and the
`RISK_TO_AUTHORITY` table. HEPHAESTUS must settle: what a grant can constrain
beyond a scope name, how the authority token is bound so it cannot be replayed
or lifted to another invocation, exactly how the freshness barrier closes the
revocation TOCTOU, and what "dual control" means operationally for a
single-operator deployment.

## Decision

### Grant — extended, constraint-carrying

```
Grant {
  id, principalId,
  holder: { kind: 'principal' | 'agent', id },
  scopes: string[],
  maxRiskWithoutLiveApproval: RiskClass,        -- default LOW
  mayProceedWithoutLiveApproval: boolean,       -- default false
  resourceConstraints: ResourceConstraint[],    -- ALL must pass
  nodeConstraints: string[],                    -- allowed originNodeId / hostNodeId; empty = any owned
  timeWindows: TimeWindow[],                     -- empty = always
  version: number,                              -- bumped on ANY change
  issuedAt, expiresAt?, revokedAt?
}

ResourceConstraint =
  | { kind: 'repo-allow',    values: string[] }
  | { kind: 'path-prefix',   value: string }
  | { kind: 'domain-allow',  values: string[] }
  | { kind: 'command-allow', values: string[] }   -- argv[0] allowlist for terminal
  | { kind: 'container-image-allow', values: string[] }
  | { kind: 'max-amount',    currency: string, value: number }  -- spend ceiling
```

The Executor evaluates `resourceConstraints` against the concrete invocation
input **after** the Policy decision and **before** minting — a constraint
failure is `DENIED`, not `REQUIRE_APPROVAL`.

### Authority token — bound three ways

Minted by the Permission Engine only, only for an invocation Policy resolved to
`ALLOW` (or `APPROVED` after workflow):

```
AuthorityToken {
  token,                       -- opaque, 256-bit, single-use
  invocationId,                -- bound: rejected if presented for another invocation
  grantId, grantVersion,       -- bound: freshness barrier re-checks
  principalId,                 -- bound: must equal the resource's principalId
  scopes, mode: 'dry-run' | 'full',
  issuedAt, expiresAt          -- short TTL (default 120 s), stored in Redis
}
```

The token is handed to the Executor, never to the adapter worker. The worker
gets a **credential handle** from the broker (ADR-0025 §2), which the broker
mints only against a live, unexpired, unconsumed token for that `invocationId`.

### Freshness barrier

Inside the single transaction that writes the `EXECUTING` row and appends
`jarvis.capability.started`:

1. `SELECT version, revoked_at FROM agency.grants WHERE id = $grantId FOR SHARE`
2. if `version != token.grantVersion` or `revoked_at IS NOT NULL` or
   `expires_at < now()` ⇒ append `jarvis.capability.aborted`, roll the
   transaction's row to `ABORTED`, **do not mint**, stop.
3. else acquire the `resourceKey` lease row (`FOR UPDATE`), append
   `capability.started`, commit.

A grant revoked at any instant before this `SELECT` cannot be used; a grant
revoked after it is caught by the next invocation (and long-running actions
hold a revocable lease the Permission Engine can break).

### Approval workflow

- `REQUIRE_APPROVAL` ⇒ Permission Engine creates an `ApprovalRequest`
  (`pending`), the Notification Manager surfaces it — with the simulated
  effect if `riskClass >= HIGH` and `simulatable` — on a trusted surface
  (`owned-secure` node, operator identity, `authTrustLevel >= trusted`).
- Operator actions: `approve`, `reject`, `edit-then-approve` (edits the
  `input`; the edited invocation re-enters Validator → Policy from the top).
- **Timeout** (default 15 min) or **operator unreachable** ⇒ `expired` ⇒
  `DENIED` (**fail closed**) unless the driving grant carries
  `mayProceedWithoutLiveApproval` for a scope covering the action, in which
  case ⇒ `APPROVED` with `approvalEvidence: { kind: 'standing-grant', grantId }`.

### Dual control (CRITICAL)

`requiredAuthorisations = 2`. In the single-operator MK.42/47 deployment the
two are **distinct deliberate acts by the operator on a trusted surface**:

1. an `approve` on the `ApprovalRequest`, **and**
2. a typed **confirmation phrase** matching a per-capability
   `confirmationPhrase` in the manifest (e.g. `DROP PRODUCTION jarvis-prod`),
   submitted as a separate `Command`; the phrase's hash is stored as
   `approvalEvidence`.

Both must land within the approval TTL, from the same `sessionId`, at
`authTrustLevel: verified`. CRITICAL is **always** simulate-first; a
`simulatable: false` CRITICAL action surfaces "no simulation available" and
still requires both authorisations. True two-person control (two principals) is
deferred to multi-user (ROADMAP MK.90+) and the `requiredAuthorisations` field
already carries it.

### Objective authority composition

Per the MIND spec §9.4: at the Orchestrator's RISK stage,
`effectiveGate = strictest(policyPreview, objectiveCategoryGate)` — restrict
only. The Executor's binding Policy + Permission checks are unaffected by it;
the objective grants nothing.

## Alternatives considered

- **Scope strings only, no resource constraints.** Then "GitHub write" means
  every repo, "filesystem write" means every path. Rejected — the constraint
  list is what makes a grant least-privilege in practice.
- **Long-lived bearer authority token (minutes–hours).** A leaked token is a
  standing capability. Rejected — 120 s TTL, single-use, invocation-bound.
- **Freshness check outside the started transaction.** Leaves a TOCTOU window
  between check and lease. Rejected — it must be in the same transaction as
  the row write and the event append.
- **Dual control = a second confirmation click.** Two clicks in one flow is
  one act. Rejected — two distinct acts (approve + typed phrase), separate
  commands, verified trust.

## Benefits

- A grant is least-privilege by construction: scope + repo/path/domain/command
  allowlists + node + time window + spend ceiling.
- A leaked authority token is worthless (wrong invocation, expired in 2 min,
  already consumed).
- Grant revocation takes effect at the next invocation and can break an
  in-flight lease — no "it was allowed when it started" loophole for long
  actions.
- CRITICAL cannot be reached by any single automated or accidental act.

## Disadvantages

- More fields to author correctly on every grant; a too-broad grant is still
  possible if the operator issues one.
- The typed confirmation phrase is friction on genuine CRITICAL actions (by
  design).

## Risks

- **Operator issues a wildcard grant ("github write, all repos, no
  expiry").** Mitigated: the grant-issue UI defaults every constraint to
  present-and-narrow and every grant to a 30-day `expiresAt`; the Audit
  Manager reports "current effective authority" so drift is visible; Sentinel
  flags a grant with empty `resourceConstraints` at `riskClass >= HIGH`.
- **`mayProceedWithoutLiveApproval` becomes the norm.** Mitigated: it is
  per-grant, per-scope, off by default, audited on issue, and listed in the
  effective-authority report.

## Consequences

- `permission.ts`: `Grant` gains `resourceConstraints`, `nodeConstraints`,
  `timeWindows`; `AuthorityToken` gains `principalId`, `invocationId` binding
  semantics documented; `ApprovalRequest` gains `approvalEvidence`,
  `confirmationPhraseHash`.
- `capability.ts`: `CapabilityAction` gains `confirmationPhrase?` (required
  present for any `riskClass: CRITICAL` action at registration).
- Schema `agency.grants`, `agency.approvals`, `agency.resource_leases`.
- `SECURITY_MODEL.md` §7 rewritten to this workflow.

## Reversal difficulty

**High.** The token binding, the freshness barrier, and dual control are the
enforcement of L18/L19. Additive constraint kinds are Low; the binding model
is not cheap to change once adapters and grants exist.
