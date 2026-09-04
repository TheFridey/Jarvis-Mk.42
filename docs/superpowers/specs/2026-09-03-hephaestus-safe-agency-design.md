# HEPHAESTUS — Safe Agency Design Spec

**Phase:** MK.47 HEPHAESTUS (collapses ROADMAP MK.44 "Authority" + MK.50
"Agency breadth"). **Status:** approved architecture; ready for implementation
planning. **Author:** Principal Security Architect (Claude Opus 5 / Sonnet 5).
**Executor of Stage B:** Codex GPT-5.6 SOL.

**Spec grounding:** `PRINCIPLES.md` L18–L31, L38; `KERNEL_CONSTITUTION.md`
§1–§3; `SECURITY_MODEL.md`; `AGENCY_MODEL.md`; ADR-0016, ADR-0018, ADR-0019;
**ADR-0025, ADR-0026, ADR-0027, ADR-0028, ADR-0029, ADR-0030** (this phase).
MIND spec §5, §9.4, §13 (the "no model is authority" proof this phase must
keep true for effects).

> **For agentic workers:** implement task-by-task via
> `superpowers:subagent-driven-development` or `superpowers:executing-plans`
> against the plan generated from this spec. Do **not** weaken permission
> evaluation, policy checks, verification, rollback, capability isolation,
> audit, or credential boundaries. If implementation conflicts with this spec,
> write an ADR proposal — do not bypass the boundary.

---

## Global Constraints (verbatim, every task inherits these)

- **No effect exists outside the Executor pipeline.** Validator → Policy →
  Permission → freshness barrier → (simulate ≥HIGH) → execute → verify → emit.
  No stage is skippable, by anyone, in any mode.
- **The Policy Engine is a pure function of typed inputs.** No network, no
  model call, no wall-clock read (`context.now` is supplied). Same inputs ⇒
  same decision. A rule may read `context.llmRecommendation` **only** to
  produce `DENY`.
- **Adapters and agents hold no credential.** Adapter workers start with zero
  inherited environment and reach secrets only through a per-invocation
  `ctx.credential` handle minted by the Credential Broker.
- **`verify` is mandatory and Executor-run** against the world, never the
  adapter's return value. "Assumed success" is not a code path.
- **`reversible: true` + non-empty `sideEffects` ⇒ `rollback` required** at
  registration. Rollback is itself verified. Failed rollback ⇒ CRITICAL alert.
- **Fail closed.** Unreachable approver, missing scope, stale grant, unknown
  capability, unconfigured policy for `riskClass ≥ MEDIUM` ⇒ the action does
  not run.
- **`derivedFromUntrusted` caps at `riskClass ≤ LOW`** and forbids a strong
  belief write (ADR-0018 §4.3).
- **Every pipeline transition emits a ledger event** — `AUDIT` class, or
  `SECURITY` class for denials / aborts / verification failures / credential
  mints / GUARDIAN.
- **No component holds both model/agent output and a capability/store
  credential** (`KERNEL_CONSTITUTION.md` §2.2, ADR-0018).
- **No offensive capability.** The SDK, the Registry, and `scripts/lint.mjs`
  reject a manifest whose `sideEffects` contain active-intrusion verbs.
- **Toolchain (inherited from MK.43 notes):** plain composition root (no Nest
  decorators), `scripts/lint.mjs` not eslint, `@opentelemetry/api` only,
  `docker` CLI not testcontainers, `exactOptionalPropertyTypes` disabled;
  relative imports carry `.ts`; vitest; unit `*.test.ts` co-located,
  integration `*.integration.test.ts` gated by `JARVIS_IT=1`.

---

## 1. Scope

### 1.1 In scope (this phase builds all of it)

1. **Authority core** — Capability Registry (#10), Policy Engine (#8),
   Permission Engine (#9), Capability Executor (Kernel-internal service),
   Credential Broker (Kernel-internal service), Adapter Host (`apps/adapter-host`).
2. **Capability SDK** — `@jarvis/capability-sdk` + `capabilities/` tree +
   security lint.
3. **Eight domain adapters** — `filesystem`, `github`, `docker`, `terminal`,
   `windows`, `browser`, `web`, `telemetry` — real, each least-privilege.
4. **Future-domain interfaces** — `email`, `calendar`, `scalesmiths`,
   `smart-home`, `mobile`, `robotics`: manifest skeletons + typed adapter
   interfaces, no implementation.
5. **Sentinel** — detector service + `sentinel` specialist behaviour + the
   active-intrusion denylist.
6. **Guardian Response Playbook** — the six restrict-only steps, wired to the
   `GUARDIAN` mode transition.
7. **FORGE self-extension + JARVIS LABS** — `apps/labs` sandbox, `forge`
   draft-proposal behaviour, the 7-step promotion pipeline (operator-gated).
8. **Security test suite** — all 28 threats + the brief's 17 scenarios.

### 1.2 Out of scope

- The Cognition Orchestrator's *planning* pipeline (MIND spec / MK.45–48). This
  phase provides the Executor it calls and consumes its `capability_invocation`
  proposals; it does not build plan sequencing.
- Real `email`/`calendar`/`scalesmiths`/`smart-home`/`mobile`/`robotics`
  adapters.
- HSM / TPM key storage (keychain + secrets file, per MK.42 non-goals).
- Multi-principal two-person control (the `requiredAuthorisations` field
  carries it; MK.90+ implements it).

### 1.3 Constitutional grounding

| Requirement | Law | Enforcement in this phase |
|---|---|---|
| Every consequential action permissioned | L18 | single Executor; credential partitioning makes it the only effect path |
| Higher risk ⇒ stronger authority | L19 | `RISK_TO_AUTHORITY` + Permission Engine refusal + dual control |
| Deterministic policy | L20 | pure AST evaluator, determinism property test |
| Model may recommend, never override | L21 | rule-validation forbids a non-DENY rule referencing `llmRecommendation` |
| Verify not assume | L22 | Executor-run `verificationStrategy`; adapter return untrusted |
| Reversible ⇒ rollback | L23 | registration rejects a reversible side-effecting action without `rollback` |
| Simulate dangerous first | L24 | `riskClass ≥ HIGH` ⇒ simulate under dry-run credential |
| Extend without Kernel mutation | L28 | capability = manifest (data) + out-of-process adapter |
| Kernel protected | L29 | Executor/Broker are internal services; FORGE cannot edit Kernel or self-register |
| Security architectural | L30 | boundaries are process + credential + Validator + deterministic policy |
| Auditable | L31 | every transition is a ledger event; audit derived from the append-only log |
| Robotics/devices later | L38 | just CRITICAL-heavy manifests on a node; pipeline unchanged |

---

## 2. Component & process map

| Unit | Where | Kind | Owns |
|---|---|---|---|
| Capability Registry | `apps/core/src/kernel/capability-registry/` | Kernel #10 | `agency.capabilities`, `agency.capability_versions` |
| Policy Engine | `apps/core/src/kernel/policy/` + `@jarvis/permissions` | Kernel #8 | `agency.policy_rules`, the evaluator |
| Permission Engine | `apps/core/src/kernel/permission/` + `@jarvis/permissions` | Kernel #9 | `agency.grants`, `agency.approvals`, token minting |
| Capability Executor | `apps/core/src/kernel/executor/` | Kernel-internal service | `agency.invocations`, `agency.invocation_steps`, `agency.resource_leases` |
| Credential Broker | `apps/core/src/kernel/credential-broker/` | Kernel-internal service | credential material (memory only); `agency.credential_grants` (audit of mints) |
| Adapter Host | `apps/adapter-host/` | deployable (server + workstation) | worker spawn, IPC to Executor |
| Sentinel detector | `apps/core/src/kernel/sentinel/` | Kernel-internal, read-only | detector config, `agency`/`security` alert projections |
| Sentinel agent | `agents/sentinel/` | specialist manifest | — (proposes only) |
| Guardian playbook | `apps/core/src/kernel/mode/guardian-playbook.ts` | data + wiring | — |
| FORGE | `agents/forge/` | specialist manifest | — (drafts, proposes) |
| JARVIS LABS | `apps/labs/` | deployable (server) | ephemeral sandbox lifecycle, `agency.labs_runs` |
| Capability SDK | `packages/capability-sdk/` | library + codegen | `defineCapability`, manifest gen, testkit |
| Capability definitions | `capabilities/<id>/` | data + adapter source | one dir per capability |

`@jarvis/permissions` is a **real package this phase** (Policy + Permission
pure logic, imported by `apps/core`). `packages/capabilities` README stub is
retired in favour of `@jarvis/capability-sdk` + `capabilities/`.

---

## 3. Contract deltas (`packages/contracts/src/`)

All additive. `exactOptionalPropertyTypes` is off, so optional fields need no
`| undefined`.

### 3.1 `capability.ts` — extend

```ts
// Capability += 
  description: string;
  provider: string;                       // "github", "filesystem", ...
  executionEnvironment:
    | 'worker'
    | 'worker+container'
    | `node-local:${string}`;             // pinned nodeId
  auditPolicy: {
    hashInput: boolean;                   // default true; false only for AMBIENT reads
    recordOutput: 'none' | 'summary' | 'full';
  };
  privacyRequirements: { maxContentPrivacyClass: PrivacyClass };

// CapabilityAction +=
  approvalPolicy: 'default' | 'always' | 'hard_confirmation' | `preauthorized:${string}`;
  timeoutMs: number;
  verificationStrategy: VerificationStrategy;   // structured, replaces bare ActionRef semantics
  rollbackStrategy?: RollbackStrategy;
  idempotencyKeySelector?: string;              // JSONPath-ish over input
  confirmationPhrase?: string;                  // REQUIRED present when riskClass === 'CRITICAL'
  declaredEgress?: string[];                    // hostnames ctx.http may reach

export type VerificationStrategy =
  | { kind: 'world-read'; adapterRef: ActionRef }        // verify() re-reads + asserts
  | { kind: 'event-await'; eventType: string; matchPath: string; timeoutMs: number }
  | { kind: 'hash-match'; ofPath: string; expectPath: string }
  | { kind: 'health-probe'; adapterRef: ActionRef }
  | { kind: 'state-echo'; adapterRef: ActionRef };       // device reported-state == requested

export type RollbackStrategy =
  | { kind: 'inverse-action'; adapterRef: ActionRef }
  | { kind: 'restore-snapshot'; capturedBy: ActionRef; restoreRef: ActionRef }
  | { kind: 'saga-compensate' };                          // steps[].compensate

// InvocationOutcome += 'partially_completed' | 'failed' | 'simulated'
```

### 3.2 New `agency.ts`

```ts
export type InvocationState =
  | 'PROPOSED' | 'VALIDATED' | 'POLICY_CHECKED'
  | 'AWAITING_APPROVAL' | 'APPROVED'
  | 'SIMULATING' | 'SIMULATED'
  | 'EXECUTING' | 'VERIFYING' | 'COMPLETED'
  | 'REJECTED' | 'DENIED' | 'ABORTED' | 'FAILED'
  | 'VERIFICATION_FAILED'
  | 'ROLLING_BACK' | 'ROLLED_BACK'
  | 'COMPENSATING' | 'PARTIALLY_COMPLETED';

export const TERMINAL_INVOCATION_STATES: readonly InvocationState[];
export const LEGAL_INVOCATION_TRANSITIONS: Record<InvocationState, InvocationState[]>;

export interface InvocationLifecycle {
  invocationId: Ulid;
  capabilityId: string; capabilityVersion: string; action: string;
  state: InvocationState;
  correlationId: CorrelationId; principalId: PrincipalId;
  originActor: EventActor;                 // who proposed (agent/principal/objective)
  riskClass: RiskClass;
  grantId?: Ulid; grantVersion?: number;
  approvalRequestId?: Ulid;
  resourceKey?: string; leaseId?: Ulid;
  inputHash: string;
  beforeStateRef?: string;                 // evidence id of the captured before-state
  predictedEffectRef?: string;             // from simulate
  verifyReportRef?: string;
  startedAt?: Timestamp; finishedAt?: Timestamp;
  history: Array<{ state: InvocationState; at: Timestamp; eventId: Ulid }>;
}

export interface CredentialHandle {
  handleId: string;                        // opaque; NOT the secret
  invocationId: Ulid;
  scope: { capabilityId: string; action: string; resourceRef: string };
  mode: 'dry-run' | 'full';
  expiresAt: Timestamp;
  kind: 'derived' | 'wrapped-static';
}

export interface AdapterContext {
  input: unknown;
  mode: 'dry-run' | 'full';
  credential: CredentialHandle;            // adapter calls ctx.useCredential() to act; never sees material for 'derived'
  log: (level: 'debug'|'info'|'warn'|'error', msg: string, fields?: Record<string, unknown>) => void;
  http: (req: { method: 'GET'|'POST'|'PUT'|'DELETE'|'PATCH'; url: string; /* ... */ }) => Promise<unknown>;
  abortSignal: AbortSignal;
}

export interface VerificationReport { verified: boolean; checks: Array<{ name: string; ok: boolean; detail: string }>; }
export interface RollbackReport { undone: boolean; residual: string[]; }
export interface PredictedEffect { summary: string; changes: Array<{ resource: string; from: unknown; to: unknown }>; }

// FORGE / LABS
export interface CapabilityDraftProposal extends ProposalBase {
  kind: 'capability_draft';
  manifest: unknown;                       // candidate Capability (unvalidated)
  adapterSource: string; testSource: string;
  researchNotes: string; declaredEgress: string[];
}
export interface LabsRunReport {
  runId: Ulid; draftId: Ulid;
  build: { ok: boolean; log: string };
  tests: { passed: number; failed: number; report: string };
  staticAnalysis: { tscOk: boolean; lintOk: boolean; manifestOk: boolean; depAuditOk: boolean; egressOk: boolean; findings: string[] };
  verdict: 'passed' | 'failed';
  artifactHash: string;
  startedAt: Timestamp; finishedAt: Timestamp;
}
```

### 3.3 `policy.ts` — extend

```ts
// PolicyContext +=
  resourceRef: string;
  originNodeId: string;
  location?: EventLocation;
  authTrustLevel: 'untrusted' | 'provisional' | 'trusted' | 'verified';
  authMethod: string;
  jarvisMode: string;                      // JarvisMode
  sessionId?: string;
  activeObjectiveGate?: 'autonomous' | 'conditional' | 'approval' | 'hard_confirmation';
  recentDenialCount: number;

// PolicyRule.predicate: the AST union (ADR-0026), typed:
export type PolicyPredicate =
  | { op: 'and' | 'or'; args: PolicyPredicate[] }
  | { op: 'not'; arg: PolicyPredicate }
  | { op: 'eq'|'ne'|'lt'|'lte'|'gt'|'gte'; path: string; value: unknown }
  | { op: 'in'|'not-in'; path: string; values: unknown[] }
  | { op: 'matches'; path: string; pattern: string }
  | { op: 'path-under'; path: string; prefix: string }
  | { op: 'time-window'; tz: string; windows: Array<{ dow: number[]; from: string; to: string }> }
  | { op: 'scope-held'; scope: string }
  | { op: 'risk-at-least'; class: RiskClass };
```

### 3.4 `permission.ts` — extend

```ts
// Grant +=
  resourceConstraints: ResourceConstraint[];
  nodeConstraints: string[];
  timeWindows: Array<{ tz: string; dow: number[]; from: string; to: string }>;

export type ResourceConstraint =
  | { kind: 'repo-allow'; values: string[] }
  | { kind: 'path-prefix'; value: string }
  | { kind: 'domain-allow'; values: string[] }
  | { kind: 'command-allow'; values: string[] }
  | { kind: 'container-image-allow'; values: string[] }
  | { kind: 'max-amount'; currency: string; value: number };

// AuthorityToken += principalId: PrincipalId;   // binding documented in ADR-0027
// ApprovalRequest +=
  approvalEvidence?: { kind: 'operator' | 'standing-grant'; by?: string; at?: Timestamp; surface?: string; grantId?: Ulid };
  confirmationPhraseHash?: string;
```

### 3.5 `proposal.ts` — extend

`ProposalKind += 'capability_draft'`; union `+= CapabilityDraftProposal`.

### 3.6 `event-names.ts` — add (`§4`)

---

## 4. Event catalog (`jarvis.<plane>.<domain>.<name>`)

All `AUDIT` retention unless marked. `agency` plane.

| Event | Emitted by | Retention |
|---|---|---|
| `jarvis.agency.capability.registered` / `.deprecated` | Registry | AUDIT |
| `jarvis.agency.invocation.proposed` | Executor | AUDIT |
| `jarvis.agency.invocation.validated` / `.rejected` | Executor | AUDIT / SECURITY |
| `jarvis.agency.invocation.policy_checked` / `.denied` | Executor | AUDIT / SECURITY |
| `jarvis.agency.invocation.awaiting_approval` / `.approved` / `.approval_expired` | Permission Engine | AUDIT |
| `jarvis.agency.invocation.simulated` | Executor | AUDIT |
| `jarvis.agency.invocation.started` | Executor (freshness-barrier tx) | AUDIT |
| `jarvis.agency.invocation.aborted` | Executor | SECURITY |
| `jarvis.agency.invocation.step_completed` | Executor | AUDIT |
| `jarvis.agency.invocation.verified` / `.verification_failed` | Executor | AUDIT / SECURITY |
| `jarvis.agency.invocation.failed` | Executor | AUDIT |
| `jarvis.agency.invocation.rolled_back` / `.compensated` / `.partially_completed` | Executor | AUDIT |
| `jarvis.agency.grant.issued` / `.revoked` / `.modified` | Permission Engine | AUDIT |
| `jarvis.agency.lease.acquired` / `.released` / `.broken` | Executor | AUDIT |
| `jarvis.agency.capability_gap` | Orchestrator/Objective | OPERATIONAL |
| `jarvis.agency.capability.probation.entered` / `.cleared` | Registry | AUDIT |
| `jarvis.agency.labs.run_started` / `.run_finished` | LABS | AUDIT |
| `jarvis.security.credential.minted` | Credential Broker | SECURITY |
| `jarvis.security.alert.low` / `.elevated` / `.high` / `.critical` | Sentinel detector | SECURITY |
| `jarvis.security.guardian.entered` / `.step_completed` / `.cleared` | Mode + playbook | SECURITY |

Validation schemas for every payload in `@jarvis/validation`
(`payloads.schema.ts`), keyed by the `EventNames.*` constant, tested in
`agency-payloads.test.ts`.

---

## 5. Schema `agency` (migration `0008_agency.sql`)

Per-schema DB role `agency_rw` (Kernel only). Tables:

- `agency.capabilities(id pk, latest_version, description, provider, execution_environment, trust_tier_min, audit_policy jsonb, privacy_requirements jsonb, active bool, created_at)`
- `agency.capability_versions(capability_id fk, version, manifest jsonb, adapter_artifact_hash, registered_by, registered_at, pk(capability_id, version))`
- `agency.policy_rules(id pk, version, description, predicate jsonb, effect, priority, enabled, created_at, created_by)` — append-only on version bump; current = max version enabled
- `agency.grants(id pk, principal_id, holder_kind, holder_id, scopes text[], max_risk_without_live_approval, may_proceed_without_live_approval bool, resource_constraints jsonb, node_constraints text[], time_windows jsonb, version int, issued_at, expires_at, revoked_at)`
- `agency.approvals(id pk, invocation_id fk, risk_class, summary, simulated_effect jsonb, state, required_authorisations int, received_authorisations int, approval_evidence jsonb, confirmation_phrase_hash, requested_at, decided_at)`
- `agency.invocations(invocation_id pk, capability_id, capability_version, action, state, correlation_id, principal_id, origin_actor jsonb, risk_class, grant_id, grant_version, approval_request_id, resource_key, lease_id, input_hash, before_state_ref, predicted_effect_ref, verify_report_ref, started_at, finished_at)` — folded projection; single-writer (Executor)
- `agency.invocation_steps(invocation_id fk, ordinal, name, state, verify_report_ref, compensated bool, pk(invocation_id, ordinal))`
- `agency.resource_leases(resource_key pk, invocation_id, acquired_at, expires_at)` — `FOR UPDATE` mutual exclusion
- `agency.credential_grants(id pk, invocation_id, handle_id, scope jsonb, mode, kind, minted_at, expires_at)` — **no secret material, ever**
- `agency.labs_runs(run_id pk, draft_id, verdict, report jsonb, artifact_hash, started_at, finished_at)`
- `agency.security_alerts(id pk, severity, detector, finding jsonb, corroboration int, raised_at, acknowledged_at)`

Migration test (`0008 applies`, correct roles, no cross-schema grant) mirrors
the MK.46 `0005/0006` migration test.

---

## 6. The Executor pipeline (normative sequence)

```
INPUT: CapabilityInvocationProposal (from Orchestrator / Objective / Experience / Guardian playbook)

 1. PROPOSED        write agency.invocations row; emit invocation.proposed
 2. VALIDATED       Validator: manifest exists + version match; input ⊨ action.inputSchema;
                    evidence-trust check → context.derivedFromUntrusted;
                    fail ⇒ REJECTED (SECURITY) + stop
 3. resolve riskClass from the manifest action; apply approvalPolicy override (restrict-only)
 4. POLICY_CHECKED  PolicyEngine.evaluate(PolicyQuery) — pure
                    DENY ⇒ DENIED (SECURITY) + stop
                    REQUIRE_APPROVAL ⇒ step 5
                    ALLOW ⇒ step 7
 5. resourceConstraints check against concrete input  → fail ⇒ DENIED + stop
 6. AWAITING_APPROVAL  Permission Engine opens ApprovalRequest; Notification Manager surfaces
                    (with simulated effect if riskClass ≥ HIGH & simulatable — run simulate now under dry-run cred);
                    approve ⇒ APPROVED ; reject/expire ⇒ DENIED (fail closed unless standing-grant scope) 
                    CRITICAL ⇒ requiredAuthorisations = 2 (operator approve + typed confirmationPhrase, same session, authTrustLevel verified)
 7. MINT            Permission Engine mints AuthorityToken(invocationId, grantId, grantVersion, principalId, scopes, mode)
 8. FRESHNESS BARRIER (one tx):
                    SELECT grant.version, revoked_at FOR SHARE
                    mismatch/revoked/expired ⇒ emit invocation.aborted (SECURITY); ABORTED; stop
                    acquire agency.resource_leases[resourceKey] FOR UPDATE
                    write EXECUTING row + emit invocation.started       (all in this tx)
 9. SIMULATING      if riskClass ≥ HIGH:
                       simulatable ⇒ broker.mint(mode:'dry-run'); adapter.simulate; emit invocation.simulated; PredictedEffect stored
                       not simulatable ⇒ (approval already carried the "no simulation available" escalation)
10. EXECUTING       broker.mint(mode:'full'); Adapter Host spawns worker (or container); adapter.execute(ctx, input)
                       wall-time cap = action.timeoutMs; abortSignal on breach
                       multi-step ⇒ per step: run, adapter.verify(step), emit step_completed
11. VERIFYING       Executor runs verificationStrategy against the world
                       verified ⇒ COMPLETED; emit invocation.verified; write World Model facts (epistemicStatus: observed, evidence = verify run); release lease
                       not verified & reversible ⇒ ROLLING_BACK → adapter.rollback → Executor re-verifies undo → ROLLED_BACK
                       not verified & irreversible ⇒ VERIFICATION_FAILED (SECURITY) → Health + Notification + Sentinel
                       rollback itself fails ⇒ CRITICAL alert + GUARDIAN recommendation
12. release lease; broker revokes handle; worker torn down; finishedAt set
```

**Restart recovery:** on Kernel start, `agency.invocations` rows in
`EXECUTING`/`SIMULATING`/`ROLLING_BACK`/`COMPENSATING` with no terminal event
⇒ the Executor reads `invocation_steps`, runs `compensate` for completed steps
in reverse (saga), emits `invocation.compensated` / `.partially_completed`.
Non-idempotent step + uncertainty ⇒ always compensate, never re-run.

---

## 7. Risk model

Enum unchanged: `AMBIENT | LOW | MEDIUM | HIGH | CRITICAL` (brief's `READ_ONLY`
≡ `AMBIENT`, `MODERATE` ≡ `MEDIUM`). `RISK_TO_AUTHORITY` unchanged.

`riskClass` is assigned per action in the manifest; the Registry's manifest
validator requires the author to justify anything **below** the table's
default for that shape:

| Action shape (from `sideEffects` + `reversible`) | Min riskClass |
|---|---|
| pure read, no PII | AMBIENT |
| read PII / private resource | LOW |
| reversible write in a scoped workspace | MEDIUM |
| irreversible write, external effect, code push, staging deploy, comms send, media egress, shell command | HIGH |
| data deletion, prod deploy, spend, financial, robotics motion, credential/grant change | CRITICAL |

Blast-radius factors the manifest must declare (consumed by policy + Sentinel
baselines): `dataModification`, `reversibility`, `externalEffect`,
`financialEffect`, `securityEffect`, `productionEffect`, `privacyImpact`,
`estimatedAffectedResources`.

---

## 8. The eight adapters (least-privilege sketch; full manifests in the plan)

| Capability | Key actions (risk) | Credential | Isolation | Notable gates |
|---|---|---|---|---|
| `capabilities.filesystem` | `read_file`(LOW) `list_dir`(LOW) `write_file`(MEDIUM) `delete_file`(HIGH) | workspace-rooted FS handle from broker; `path-prefix` constraint | worker | canonicalize + `path-under` workspaceRoot; refuse symlink escape; no `..` |
| `capabilities.github` | `list_*`/`get_*`(LOW) `create_branch`(MEDIUM) `open_pr`(MEDIUM) `merge`(HIGH) `push --force`(HIGH) | fine-grained installation token, repo+perm scoped, ≤1h | worker | `repo-allow`; merge to protected ⇒ REQUIRE_APPROVAL; verify = ref at expected SHA on remote |
| `capabilities.docker` | `ps`/`inspect`(LOW) `run`(HIGH) `stop`(MEDIUM) `rm -f`/`prune`(CRITICAL) | socket **proxy** with per-invocation command allowlist | worker | `container-image-allow`; no raw socket; verify = container state / health |
| `capabilities.terminal` | `run`(HIGH) | none (spawns allowlisted binary directly) | worker | **argv array only, no shell, no `sh -c`, no interpolation**; `command-allow` (argv[0]); simulate = describe; verify = declared effect check |
| `capabilities.windows` | `read_*`(LOW/AMBIENT) `set_registry`(HIGH) `service_control`(HIGH) `notify`(LOW) | scoped OS API surface | `node-local:<workstation>` | fixed API allowlist; no arbitrary process spawn; verify = state echo |
| `capabilities.browser` | `open`(LOW) `navigate`(LOW) `extract_text`(LOW) `click`/`fill`(MEDIUM) `download`(HIGH) | isolated ephemeral profile, no cred store | `worker+container` | fetched content tagged `untrusted` + provenance; downloads quarantined; no credential autofill |
| `capabilities.web` | `get`(LOW) | none (GET-only HTTP) | worker | `domain-allow`; response body `untrusted` + `origin` provenance; no POST/PUT; size cap |
| `capabilities.telemetry` | `read_metrics`(AMBIENT) `list_processes`(AMBIENT) `disk_health`(AMBIENT) | read-only host handle | worker (pooled) | read-only; feeds Sentinel baselines |

**Future interfaces** (`capabilities/email/`, `calendar/`, `scalesmiths/`,
`smart-home/`, `mobile/`, `robotics/`): `defineCapability` manifest with
actions + risk + schemas, `execute` throwing `NOT_IMPLEMENTED`. Registered as
`active: false`. Proves the pipeline gates them with no new mechanism (L38).

---

## 9. Credential model (detail)

- **Broker startup:** loads material from OS keychain (`keytar`-equivalent) or
  a `0600` secrets file path in config; holds it in a `Map` in memory; never
  writes it anywhere.
- **`mint(invocationId, capId, action, resourceRef, mode)`** returns a
  `CredentialHandle`:
  - `derived`: the broker calls the backend's token API (GitHub app JWT →
    installation token scoped to `resourceRef` repos + the action's
    permissions; AWS STS; a signed short-TTL Docker-proxy token) and returns a
    handle the worker redeems via `ctx.useCredential()` which injects the
    token **into the outbound request the adapter makes through `ctx.http` /
    the proxy** — the adapter code never receives the string.
  - `wrapped-static`: the material is sent to the worker over the IPC channel
    inside a `SecretBox` that exposes only `use(fn)` (runs `fn(secret)` and
    zeroizes); lint forbids storing it elsewhere.
  - `dry-run`: `derived` with read-only perms / a sandbox account; a
    `wrapped-static` dry-run gets a designated sandbox secret or the action is
    marked `simulatable: false`.
- **Redaction:** the worker→Executor log/result channel runs every string
  field through a redactor seeded with the minted secret's fingerprint +
  common secret patterns; a match is replaced with `«redacted»` and raises
  `jarvis.security.alert.elevated` (`cred.leak-attempt`).
- **Audit:** `agency.credential_grants` records scope + TTL + kind; the
  `input_hash` (not input) is in `agency.invocations`; secrets never enter an
  event payload, a model context, or an error message.

---

## 10. Verification & rollback (detail)

- `verificationStrategy` is executed **by the Executor** using a fresh
  read-only credential (its own, or a `dry-run` mint), not the adapter's
  `execute` return.
  - `world-read` / `health-probe` / `state-echo` call a dedicated read entry
    on the adapter under a read-only handle.
  - `event-await` waits (bounded) for a corroborating event from another
    component (e.g. `jarvis.world.fact.asserted` after a filesystem write's
    ingestion).
  - `hash-match` compares two paths of the collected state.
- **Rollback** runs only for `reversible` actions, automatically on
  `VERIFICATION_FAILED` and on an operator `capability.rollback` command
  within the action's retention window. `rollback` produces its own effect and
  the Executor **re-verifies the undo** (`RollbackReport.undone`). Residual
  items ⇒ CRITICAL alert.
- **Saga:** `steps[]` with per-step `verify` + `compensate`; the Executor
  emits `step_completed` per step; crash recovery compensates completed steps
  in reverse.
- **No "200 = success":** the adapter's HTTP status is a debug field; only the
  `verificationStrategy` result flips the state to `COMPLETED`.

---

## 11. Sentinel (detail) — see `SENTINEL_MODEL.md`

- **Detector service:** pure functions over `SECURITY`/`AUDIT`/health event
  windows + `telemetry` output; the 12 detectors of ADR-0028; emits
  `jarvis.security.alert.<severity>` with a structured `finding`; thresholds
  are versioned config with tests against synthetic incident traces.
- **`sentinel` specialist agent:** manifest `proposalScope.kinds = ['answer',
  'policy_recommendation']`, `capabilities: []`, `allowedTools:
  ['audit_query','atlas_query']` (read). Correlates alerts into an operator
  narrative. Holds nothing; output validated as untrusted.
- **No offensive capability:** the active-intrusion verb denylist is enforced
  at three points — `defineCapability` build, Registry registration,
  `scripts/lint.mjs`.
- **Severity → mode:** only `high`/`critical` (with corroboration) feed the
  `ModeTransitionPolicy` toward `GUARDIAN`; the transition still notifies the
  operator and is operator-reversible.

---

## 12. Guardian Response Playbook (detail)

Entering `GUARDIAN` runs the six steps (ADR-0028 table) as ordinary Executor
invocations of restrict-or-preserve-only capabilities:

`permission.tighten_all` (HIGH), `agency.suspend_autonomous_external` (HIGH),
`audit.snapshot` (HIGH), `node.isolate` (HIGH, only if the finding names a
node). `base.guardian.lockdown` (already-live policy rule) + the engine hard
cap handle HIGH/CRITICAL denial. `notify.operator` on every trusted surface.

Guardian **cannot** mint authority, widen a grant, register a capability, or
remove audit retention. Exit requires operator `security.cleared`; grant
tightening is undone by the operator re-issuing grants.

---

## 13. FORGE + JARVIS LABS (detail) — see ADR-0029

- `jarvis.agency.capability_gap` (data) → `forge` researches via `web`
  (GET-only, untrusted) → emits `CapabilityDraftProposal` (all
  `derivedFromUntrusted`).
- `apps/labs` materialises the draft **only** inside an ephemeral Docker
  container: synthetic creds, mock target API, throwaway PG + scratch FS, no
  route to real Kernel infra, default-deny network (docs-fetch proxy only
  during research), CPU/mem/wall/disk/proc limits, full logging, reaper-guaranteed
  teardown. Runs build + tests + the ADR-0029 step-4 static/security analysis.
  Emits `LabsRunReport` (signed) + artifact hash.
- **Human review** (blocking): operator sees manifest diff, adapter + test
  source, LABS report, dep tree, declared egress. Approval = a signed operator
  Command at `authTrustLevel: verified`.
- **Registration:** only the Capability Registry, only on that approval. There
  is no `capability.register` capability. New capability enters at
  `max(declared, HIGH)` + `approvalPolicy: 'always'` (probation) until a second
  operator `capability.trust` Command; Sentinel flags every probationary
  invocation.
- JARVIS never edits Kernel / contracts / permissions / lint / migrations /
  ADRs in any automated flow.

---

## 14. Audit requirements

The Audit Manager derives `agency.audit_trail` (a projection). For any
`invocationId` it answers, from the append-only log alone:

requesting principal + session + origin actor + objective · capability
id/version · target `resourceRef` · **input hash** · policy verdict +
`firedRuleIds` + rationale · permission result + grant id/version · approval
evidence (who, when, surface, confirmation-phrase hash) · simulated effect ·
execution result · verification report · rollback/compensation · every
timestamp · `correlationId` · `traceId`.

No component can suppress an appended event; the Executor cannot mark
`COMPLETED` without its events being in the same committed transaction as the
row. Audit partitions move to cold storage but stay queryable. `SECURITY`-class
events are indefinite and tamper-evident.

---

## 15. Testing — the security suite (`*.security.test.ts`, in the unit suite; adapter integration gated by `JARVIS_IT=1`)

### 15.1 The 28 threats (each ⇒ at least one test asserting the structural block)

T1 jailbroken model · T2 web-page injection · T3 compromised adapter ·
T4 rogue agent · T5 malicious guest node · T6 unreachable-approver auto-approve ·
T7 replay (stale command / token) · T8 exfiltration via cognition ·
T9 state-corruption race · T10 self-DoS · T11 malformed output · T12 node
impersonation · T13 grant privilege creep · T14 sensitive context to cloud ·
T15 supply chain · **T16** tool-output injection · **T17** malicious document ·
**T18** poisoned retrieval · **T19** capability privilege escalation ·
**T20** confused deputy · **T21** event spoofing / forged ledger event ·
**T22** credential leakage (log/context/error) · **T23** malicious extension ·
**T24** command injection into `terminal` · **T25** cross-user resource access ·
**T26** unsafe/failed rollback · **T27** fake verification (adapter lies) ·
**T28** action race / double-execution / TOCTOU.

### 15.2 The brief's 17 scenarios

capability injection · prompt injection · untrusted webpage · malicious agent ·
permission escalation · replay · duplicate action · race · fake success ·
failed verification · rollback failure · stolen session · compromised node ·
wrong-user access · malformed capability · timeout · partial external failure.

### 15.3 Engine-level

- **Policy determinism** property test (same `PolicyQuery` ⇒ same
  `PolicyDecision`, 10k random inputs).
- **"No model verdict"** — every base + custom rule referencing
  `context.llmRecommendation` has `effect: 'DENY'` (rule-corpus assertion).
- **Fail-closed matrix** — unreachable approver / missing scope / stale grant /
  unknown capability / unconfigured `riskClass ≥ MEDIUM` ⇒ no execution.
- **Lifecycle legality** — only `LEGAL_INVOCATION_TRANSITIONS` edges occur;
  every transition emitted an event.
- **Restart saga** — kill mid-`EXECUTING` multi-step ⇒ compensates completed
  steps in reverse on restart.
- **Freshness barrier** — revoke the grant between `POLICY_CHECKED` and the
  started tx ⇒ `ABORTED`, no mint, no effect.
- **Dual control** — CRITICAL with only the approve (no phrase), or phrase from
  a different session, or `authTrustLevel < verified` ⇒ not executed.
- **SDK security lint** — fixtures for each lint rule (a `process.env` read, a
  bare `fetch`, a missing `verify`, an intrusion verb) ⇒ lint fails.
- **LABS isolation** — a draft adapter that tries to reach the real DB / NATS /
  internet inside LABS ⇒ blocked + recorded; teardown leaves nothing.

### 15.4 Closing boundary sweep ("find accidental authority")

Re-run the MIND §13.4 sweep for effects: enumerate every path from
model/agent/web output to an effect; assert each hits Validator → Policy →
Permission → freshness → (simulate) → execute → verify with no skip. Written
into ADR-0025 as a checklist; a test walks the capability + agent manifests
and asserts no adapter is importable outside the Adapter Host and no component
holds both an adapter credential and model/agent output.

---

## 16. Implementation sub-plans (ordered; each independently testable)

The `writing-plans` skill turns this into task files. Ordering:

1. **6a — contracts, events, schema.** `agency.ts`, extend
   `capability/policy/permission/proposal.ts`, `event-names.ts` additions,
   `@jarvis/validation` payload schemas + tests, migration `0008_agency.sql` +
   migration test. Exit: `tsc` green, schema applies, payloads validate.
2. **6b — Capability SDK + `capabilities/` + security lint.** `defineCapability`,
   zod→JSON-Schema, manifest + worker codegen, testkit,
   `scripts/lint.mjs` `capabilities/**` rules + fixtures. Exit: a sample
   capability builds; every lint rule has a failing fixture.
3. **6c — Policy Engine.** AST types, total evaluator, rule validator (no
   non-DENY `llmRecommendation`; mode restrict-only), base rule pack seed,
   determinism + per-rule ALLOW/DENY tests + fuzz. Exit: base pack green,
   determinism property holds.
4. **6d — Permission Engine.** Grants + `resourceConstraints` eval, authority
   token mint + binding, approval workflow, dual control, freshness-barrier
   helper. Exit: fail-closed matrix + dual-control tests green.
5. **6e — Capability Registry.** Manifest validation (risk floors, verify /
   rollback / confirmationPhrase presence, intrusion denylist), versioning,
   probation state, lookup API. Exit: bad manifests rejected with codes.
6. **6f — Capability Executor.** The §6 pipeline, `agency.invocations`
   projection + folding, resource leases, simulate gate, verification
   execution, rollback, saga + restart recovery. Exit: lifecycle-legality,
   freshness, restart-saga, fake-verification tests green.
7. **6g — Credential Broker.** Material load, `mint` (derived + wrapped-static
   + dry-run), redaction filter, `credential_grants` audit. Exit: no secret in
   any event/log/error test; dry-run has no write access.
8. **6h — Adapter Host.** `apps/adapter-host`, worker spawn (zero env, scratch
   cwd), IPC contract, `worker+container` path, pooled reads. Exit: worker
   cannot reach NATS/DB/broker; MEDIUM+ gets a fresh process.
9. **6i — Adapters: filesystem, web, telemetry** (the safe first three, prove
   the loop end-to-end incl. simulate/verify/rollback).
10. **6j — Adapters: github, docker, terminal** (HIGH-risk; token derivation,
    socket proxy, argv-only shell).
11. **6k — Adapters: windows, browser** (node-local; container isolation) +
    the six future-domain interface stubs (`active: false`).
12. **6l — Sentinel.** Detector service + 12 detectors + synthetic-trace
    tests + `sentinel` agent manifest + intrusion denylist wired.
13. **6m — Guardian playbook.** `permission.tighten_all`,
    `agency.suspend_autonomous_external`, `audit.snapshot`, `node.isolate`
    capabilities + wiring to the `GUARDIAN` transition + tests (restrict-only,
    operator-reversible).
14. **6n — FORGE + JARVIS LABS.** `apps/labs` sandbox, `forge` draft-proposal
    behaviour, 7-step pipeline, operator-gated registration, probation +
    Sentinel flag. Exit: LABS isolation test; no automated `register`.
15. **6o — Security test suite + boundary sweep.** All 28 threats + 17
    scenarios + §15.4 sweep as executable tests.
16. **6p — Docs reconciliation.** `AGENCY_MODEL.md`, `SECURITY_MODEL.md`,
    `threat-model.md`, `SENTINEL_MODEL.md`, `KERNEL_CONSTITUTION.md`,
    `ROADMAP.md`, `GLOSSARY.md`, `apps/README.md`, `packages/README.md`,
    `SYSTEM_BOUNDARIES.md` to as-built; `MK47_HEPHAESTUS_IMPLEMENTATION_NOTES.md`
    (real vs interface-only, deviations, verified-green gate + bench).

Each sub-plan ends green on `tsc` (0), `node scripts/lint.mjs` (clean),
`vitest run` (all), and — from 6i on — the relevant `JARVIS_IT=1` adapter
integration tests where Docker is available.

---

## 17. Self-review (against the brief)

| Brief item | Covered |
|---|---|
| Capability Registry with all listed fields | §3.1 + 6e |
| Risk levels + factors | §7 |
| Capability domains (8 + 6 future interfaces) | §8 + 6i–6k |
| Authorization inputs (WHO…AUTH STRENGTH) | §3.3 `PolicyContext` |
| Example policies | ADR-0026 base pack |
| Deterministic policy, model can't override | §Global + ADR-0026 + 6c tests |
| Action lifecycle (all states) | §3.2 + §6 + 6f |
| Action transactions (11 steps) | §6 steps 1–12 |
| Verification examples | §10 + `verificationStrategy` kinds |
| Audit fields | §14 |
| Credentials (broker, scoped, short-lived, references, isolation) | §9 + ADR-0025 §2 |
| Sentinel (defensive, not offensive) | §11 + ADR-0028 |
| Guardian (bounded, not root) | §12 + ADR-0028 |
| Self-extension flow | §13 + ADR-0029 |
| JARVIS LABS | §13 + ADR-0029 |
| Capability SDK shape | ADR-0030 + 6b |
| Testing (17 scenarios) | §15.2 |
| "Meaningfully capable, dramatically safer" | the whole pipeline; no effect path bypasses it |
