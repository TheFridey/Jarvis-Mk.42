# `jarvis.engineering.v1` — capability contract design

Status: **DESIGN ONLY.** Nothing is connected. Jarvis V2 is unmodified, its
approvals remain its own, and no execution endpoint is exposed.

Scope: how Mark 42 would consume Jarvis V2's engineering loop as one bounded
capability. It defines shapes, identity, lifecycle, budgets and failure
semantics. It does not define database ownership, transport wire format, or UI.

## 1. Boundary

- Mark 42 owns authority: policy, permission, approval, audit, principal identity.
- V2 owns execution: worktrees, per-file proposals, controller verification.
- V2 keeps its SQLite store. Mark 42 keeps PostgreSQL. **No shared database.**
- One direction only: Mark 42 calls V2. V2 never calls Mark 42 except to ask for
  an approval decision through a request-scoped handle.
- The transport is loopback-only, authenticated per request, and refused when the
  origin does not match the bound principal. Nothing leaves the host.

## 2. Versioning

`version: "jarvis.engineering.v1"` is a literal on every request and every
response. Additive optional fields are a minor revision of the same version;
removing, renaming or changing the meaning of a field requires `v2`. A caller
must reject an unknown major and must ignore unknown optional fields. The Zod
schema lives in Mark 42 `packages/contracts` and is the single source for both
sides' validators.

## 3. Objective submission

```
POST simulate | execute → {
  version, requestId, idempotencyKey,
  principal: PrincipalRef, project: ProjectRef,
  objective: { statement, acceptanceCriteria[] },
  baseline: { commit, cleanRequired: true },
  stages?: StageRequest[],         // omitted → deterministic template
  limits: ExecutionLimits
}
```

- `objective.statement` is operator text; it is data, never instructions to a
  controller. `acceptanceCriteria` are declarative checks, not prompts.
- `stages` may be omitted: V2's deterministic local planner supplies
  research → planning → review → verification. A caller may never add stages
  after approval (ADR 002 decision 2) and neither may this contract.
- `baseline.commit` is pinned at approval; a moved HEAD invalidates the run.

## 4. Principal and project identity

```
PrincipalRef { principalId, kind: 'operator'|'agent'|'service', actingFor?: principalId }
ProjectRef   { projectId, rootPath, defaultBranch }
```

`projectId` is Mark 42's registry id. `rootPath` is absolute and must resolve
inside a registered root; V2 re-checks it. Mark 42's approval is bound to the
`principalId` that requested it; a substituted principal is a contract violation,
not a permission failure.

## 5. Execution lifecycle

```
states: SIMULATED → AWAITING_APPROVAL → APPROVED → APPLYING → APPLIED
                                          ↘ DENIED | EXPIRED
        APPLIED → VERIFYING → VERIFIED | VERIFICATION_FAILED
        any → INTERRUPTED | CANCELLED | CONFLICTED | SUPERSEDED
```

Monotonic; every transition carries `at`, `actor` and the reason. Terminal:
`VERIFIED`, `VERIFICATION_FAILED`, `DENIED`, `EXPIRED`, `CANCELLED`,
`CONFLICTED`, `SUPERSEDED`. `INTERRUPTED` is recoverable only through a fresh
approval (V2's existing rule — this contract does not loosen it).

## 6. Approval references

```
ApprovalRef {
  approvalId, invocationId,      // Mark 42 authority ids
  v2ApprovalId?,                 // V2's own record, when it produced one
  scopeDigest,                   // hash over files + before/after hashes
  expiresAt, nonce, version
}
```

Rules:
1. Every `execute` requires an `ApprovalRef` whose `scopeDigest` covers exactly
   the files it will touch. A mismatch is refused before any write.
2. Per-file approval is preserved: a plan of two files needs two digests. There
   is no cross-file atomicity claim.
3. Mark 42 never auto-approves and never derives a digest from a model output.
4. V2's local approval requirement is not bypassable — a Mark 42 approval is an
   *additional* authorisation, never a replacement.

## 7. Budget boundaries

```
ExecutionLimits {
  wallMsPerStage, stagesMax,
  proposalBytesMax, proposalsMax,     // V2: 128 KiB aggregate, 8 proposals
  verificationAttemptsMax: 1,
  paidSpend: { allowed: false }
}
```

- Unknown cost is treated as unaffordable. No fallback provider, no top-up, no
  automatic retry of an ambiguous paid call (V2's global latch stays).
- Exceeding any limit terminates the run; budget extension is a new approval.
- Subscription-backed execution is not a budget; it is a plain refusal when the
  provider reports unknown included usage.

## 8. Verification evidence

```
VerificationEvidence {
  kind: 'controller' | 'agent-reported',
  recipe: { id, argv[], snapshotHash },
  worktreeId, baselineCommit,
  exitCode, durationMs, outputDigest,
  verified: boolean
}
```

Only `kind: 'controller'` with `verified: true` may set `VERIFIED`. Agent text
claiming a test passed is `agent-reported` and is never evidence. This mirrors
V2's `node-unit-v1` runner and its "trustworthy counts are not inferred from
project stdout" limitation.

## 9. Idempotency

- Every mutating request carries `idempotencyKey`; replay with the same key and
  identical body returns the original result and never re-applies.
- Replay with the same key and a different body is `CONFLICTED`.
- Approval decisions are idempotent for the same decision, refused when
  conflicting (V2's existing transactional behaviour, preserved verbatim).
- Duplicate application prevention is a V2 invariant, not a caller courtesy.

## 10. Cancellation

`cancel(requestId)` stops pending and active stages, retains results and
worktrees (no automatic deletion), and marks the run `CANCELLED`. Cancellation
during final hashing or cleanup is a covered boundary in V2 and must remain so.
A cancelled run cannot be resumed; recovery is a new run with a new approval.

## 11. Artifact references

```
ArtifactRef { artifactId, runId, stageId, path, sha256, bytes, producedAt }
```

Artifacts are immutable and content-addressed; the reference is the hash. Mark 42
stores references and digests, not copies of file contents. Older revisions and
partial applications stay inspectable — supersession is a state, not a delete.

## 12. Error handling

| Code | Meaning | Caller action |
|---|---|---|
| `BASELINE_MISMATCH` | project HEAD or cleanliness differs from the approved baseline | re-approve |
| `APPROVAL_INVALID` | expired, wrong digest, wrong principal, replayed nonce | refuse, surface to operator |
| `SCOPE_VIOLATION` | touched path outside the approved grant | stop, audit |
| `CONFLICTED` | target changed since the proposal was hashed | regenerate proposal |
| `PROVIDER_UNAVAILABLE` | subscription/usage/billing gate closed | wait; no fallback |
| `LIMIT_EXCEEDED` | budget boundary hit | new approval to extend |
| `INTERRUPTED` | process died mid-run | recover only via fresh approval |
| `VERIFICATION_FAILED` | controller recipe failed | no success artifact is released |

Errors carry a stable `code`, a human `message`, and the run/stage ids. A message
is never parsed for control flow. Unknown codes fail closed.

## 13. Deliberately out of scope

No merge, push, deploy, remote hosting, shared database, exposed network
endpoint, cross-file atomicity, automatic worktree deletion, indefinite autonomy,
or second approval system. Those are refused by construction, not by convention.
