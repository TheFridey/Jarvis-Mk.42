# Agency Model

How JARVIS acts on the world: capabilities, the single Executor pipeline,
simulation, verification, rollback, and partial-execution recovery
(L18–L24, L28, L29).

Subordinate to [`PRINCIPLES.md`](PRINCIPLES.md),
[`SECURITY_MODEL.md`](SECURITY_MODEL.md).

---

## 1. Principle

**Every consequential action is a capability invocation through one pipeline.**
There is no other way to affect the world. Cognition, agents, interfaces, and
the Objective Engine all *propose*; the Capability Executor is the only thing
that *does*.

## 2. Capability contract (`packages/contracts/src/capability.ts`)

```
Capability {
  id             string        -- "capabilities.filesystem"
  version        semver
  actions:       CapabilityAction[]
  requiredScopes string[]       -- named scopes a grant must include
  resourceKey?   (input) => string   -- for execution mutual-exclusion leases
  trustTierMin   NodeTrustTier  -- lowest node trust allowed to host the adapter
}

CapabilityAction {
  name           string        -- "write_file"
  inputSchema    JSONSchema
  outputSchema   JSONSchema
  riskClass      "AMBIENT" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
  reversible     boolean
  rollback?      ActionRef      -- how to undo (required if reversible & side-effecting)
  simulate?      ActionRef      -- dry-run entry point
  simulatable    boolean        -- false => Executor escalates approval instead of simulating
  verify         ActionRef      -- REQUIRED. confirms the effect actually happened (L22)
  idempotent     boolean        -- per invocationId
  steps?         Step[]         -- for multi-step actions; each with verify + compensate
  sideEffects    string[]       -- human-readable declaration, for audit & policy
}
```

A capability is **data + an out-of-process adapter**. Registering one touches
only the Capability Registry (L28). The Kernel binary does not change (L29).

## 3. The Executor pipeline (the only path to an effect)

```mermaid
flowchart TB
    P[Proposal: invoke capability X.action with input] --> V[Validator: schema + safety + evidence-trust check]
    V -->|reject| RJ[emit capability.rejected]
    V -->|ok| RC[resolve riskClass + required authority tier]
    RC --> POL[Policy Engine: deterministic decision]
    POL -->|DENY| D1[emit capability.denied]
    POL -->|REQUIRE_APPROVAL| APR[Approval workflow]
    APR -->|no / timeout / operator unreachable| D2[emit capability.denied  (FAIL CLOSED)]
    POL -->|ALLOW| MINT
    APR -->|approved| MINT[Permission Engine: mint scoped TTL authority token]
    MINT --> BAR[Freshness barrier: re-read grant version; append capability.started in same tx]
    BAR -->|grant stale/revoked| AB[emit capability.aborted]
    BAR --> LEASE[acquire resourceKey lease if declared]
    LEASE --> SIMQ{riskClass >= HIGH?}
    SIMQ -->|yes & simulatable| SIM[adapter.simulate under dry-run cred -> predicted effect -> approval]
    SIMQ -->|yes & not simulatable| ESC[escalate approval: explicit 'no simulation available']
    SIMQ -->|no| EXE
    SIM --> EXE[adapter.execute out-of-process, scoped cred, wall-time cap]
    ESC --> EXE
    EXE --> VER[adapter.verify]
    VER -->|verified| OK[emit capability.verified + World Model facts + release lease]
    VER -->|failed & reversible| RB[adapter.rollback] --> RBD[emit capability.rolled_back]
    VER -->|failed & irreversible| ALERT[emit capability.verification_failed -> Health + Notification + Audit]
```

Every box that emits does so as a **ledger-class event** with the
`correlationId` of the originating interaction. The audit trail is complete by
construction (L31).

## 4. Risk classes → authority tiers (L19)

Full table in `SECURITY_MODEL.md` §3. Summary:

| riskClass | Example | Default authority required |
|---|---|---|
| AMBIENT | read clipboard, read focused window title | standing grant, no prompt |
| LOW | read a file in workspace, list a repo | standing grant |
| MEDIUM | write a file in workspace, open a branch, send a draft to self | standing grant + post-hoc notification |
| HIGH | run a terminal command, push to a remote, deploy to staging, send external comms, send media to cloud | live approval **or** an explicit pre-authorised standing grant scope; simulate-first |
| CRITICAL | delete data, prod deploy, financial action, robotics motion, spend money | dual control (operator + explicit confirm), always simulate-first, never auto |

The Policy Engine maps `(actor, action, riskClass, context)` to
`ALLOW | DENY | REQUIRE_APPROVAL` deterministically. An LLM
`PolicyRecommendation` may be *one input* but never the verdict (L21).

## 5. Simulation (L24, review §16.9)

- For `riskClass >= HIGH` the Executor runs `adapter.simulate` **first**. The
  adapter runs under a Kernel-injected **dry-run credential scope** (read-only
  / sandbox). The predicted effect is surfaced for approval.
- An adapter that cannot honour dry-run declares `simulatable: false`. The
  Executor then does **not** pretend to simulate — it escalates the approval
  requirement (surfaces "no simulation available for this action" to the
  approver).
- Simulation output is itself validated and audited (`capability.simulated`).

## 6. Verification (L22)

- `verify` is **mandatory** on every action. "Assumed success" is not a code
  path.
- `verify` checks the world, not the adapter's return value: file exists with
  expected hash, branch is on the remote, container is running, message id is
  in the sent folder, etc.
- Result: `capability.verified` or `capability.verification_failed` (→ rollback
  if reversible, → alert if not).
- Facts derived from a verified effect are written to the World Model with
  `epistemicStatus: observed`, evidence = the verify run.

## 7. Rollback (L23)

- `reversible: true` + side effects ⇒ `rollback` is required.
- The Executor invokes `rollback` automatically on post-execution verification
  failure, and on operator request within the retention window for reversible
  actions.
- `rollback` is itself an action with its own `verify`. A failed rollback
  escalates to CRITICAL alert.

## 8. Multi-step actions & partial execution (review §16.13)

- An action with `steps[]` declares per-step `verify` and `compensate`.
- The Executor runs steps sequentially, emitting `capability.step.completed`
  per step.
- **Crash mid-action**: on Kernel restart, a `capability.started` with no
  terminal event is detected; the Executor reads which
  `capability.step.completed` events exist and runs `compensate` for those, in
  reverse order (saga compensation). Emits `capability.compensated`.
- Adapters must make each step individually idempotent per `invocationId` or
  declare `idempotent: false`, in which case the Executor will not auto-retry
  and will always compensate on uncertainty.

## 9. Adapters (`capabilities/*`)

- Run **out-of-process**, spawned per invocation or pooled, on the node where
  the resource lives (e.g. `windows` on each workstation, `docker` on the
  server).
- Hold **only their own scoped resource credential** (a GitHub token limited to
  declared repos; a workspace-rooted filesystem handle; a Docker socket). Never
  a DB, NATS, or provider credential.
- Communicate with the Executor over a typed local channel. Cannot emit ledger
  events themselves (the Executor emits results).
- Cannot escalate their own scope, skip `verify`, or perform real side effects
  during `simulate`.

### MK.42 adapter set

`browser`, `windows`, `filesystem`, `terminal`, `github`, `docker`, `web`,
`scalesmiths`. `smart-home` and robotics are future adapters — the pipeline
already gates them (they are just CRITICAL-heavy manifests on a robot node,
L38).

## 10. What the Agency Plane must never do

- Be invoked outside the Executor pipeline.
- Skip policy, permission, the freshness barrier, or `verify`.
- Auto-execute CRITICAL, or execute HIGH without approval/standing-grant +
  simulate.
- Let an adapter hold a broad credential or escalate scope.
- Fall back to ALLOW when an approver is unreachable — it **fails closed**
  (review §16.9).
- Emit ledger events from an adapter.
