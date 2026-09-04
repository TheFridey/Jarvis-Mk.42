# HEPHAESTUS — Safe Agency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. **Read the spec alongside this plan**
> — the plan argues from it and does not restate every DDL column / event
> payload.

**Goal:** Give JARVIS safe agency — the authority core (Registry, Policy,
Permission, Executor, Credential Broker, Adapter Host), eight least-privilege
adapters, the Capability SDK, Sentinel, the Guardian Response Playbook, and
FORGE + JARVIS LABS self-extension — such that no effect exists outside the
verified, policy-gated, audited pipeline and no model or prompt can grant
authority.

**Architecture:** A capability is a manifest (data) + an out-of-process adapter.
One Capability Executor owns a 14-state action lifecycle folded from events. A
deterministic AST Policy Engine and a constraint-carrying Permission Engine
gate every invocation; a Credential Broker mints per-invocation scoped
credentials; the Adapter Host runs a zero-environment worker per invocation.
Sentinel detects deterministically and proposes; Guardian restricts only, only
through the pipeline. FORGE drafts capabilities that only JARVIS LABS builds
and only an operator registers.

**Tech stack:** TypeScript (strict, `noUncheckedIndexedAccess`,
`verbatimModuleSyntax`, `.ts` import extensions), pnpm workspace, plain
composition root (no Nest decorators), `postgres.js` + Drizzle, zod, vitest,
`scripts/lint.mjs`, `docker` CLI for integration + LABS, `@opentelemetry/api`
only.

**Spec:** `docs/superpowers/specs/2026-09-03-hephaestus-safe-agency-design.md`
(read it — contract deltas §3, event catalog §4, schema DDL §5, pipeline §6,
adapter sketches §8, test matrix §15).

## Global Constraints

- **No effect outside the Executor pipeline.** Validator → Policy → Permission
  → freshness barrier → (simulate ≥HIGH) → execute → verify → emit. No stage
  skippable, by anyone, in any mode.
- **Policy Engine is a pure total function of typed inputs.** No network, no
  model, no wall-clock read (`context.now` supplied). A rule may reference
  `context.llmRecommendation` **only** to produce `DENY` (rule-validated).
- **Adapters/agents hold no credential.** Workers start zero-env; secrets reach
  them only via a per-invocation `ctx.credential` handle from the Broker.
- **`verify` mandatory and Executor-run** against the world, never the
  adapter's return value.
- **`reversible: true` + non-empty `sideEffects` ⇒ `rollback` required** at
  registration; rollback is itself verified.
- **Fail closed** on: unreachable approver, missing scope, stale grant, unknown
  capability, unconfigured policy for `riskClass ≥ MEDIUM`.
- **`derivedFromUntrusted` caps at `riskClass ≤ LOW`** (engine hard cap).
- **Every pipeline transition emits a ledger event** — `AUDIT`, or `SECURITY`
  for denials / aborts / verification failures / credential mints / GUARDIAN.
- **No component holds both model/agent output and a capability/store
  credential.**
- **No offensive capability** — SDK + Registry + `scripts/lint.mjs` reject a
  manifest whose `sideEffects` carry active-intrusion verbs.
- **Risk enum unchanged:** `AMBIENT | LOW | MEDIUM | HIGH | CRITICAL`;
  `RISK_TO_AUTHORITY` unchanged.
- **Toolchain:** relative imports carry `.ts`; `tsc` strict must stay at 0
  errors; `node scripts/lint.mjs` must stay clean; unit `*.test.ts` co-located;
  integration `*.integration.test.ts` gated by `JARVIS_IT=1`; adapter/LABS
  integration additionally self-skips when Docker is down.
- **Migration numbering:** this plan writes `0008_agency.sql`. If the MK.45
  `0007_catalogue.sql` has not merged to this branch when Task 1 runs, use the
  next free number and update every reference in the task + spec §5. Do **not**
  reuse an existing number.

---

## File Structure

Decisions locked here. Follow existing patterns (`apps/core/src/kernel/<component>/`
plain modules; `packages/<name>/src/index.ts` public surface;
`packages/persistence/src/migrations/NNNN_*.sql`).

### New packages

| Path | Responsibility |
|---|---|
| `packages/permissions/src/` | Pure Policy + Permission logic: AST types, total evaluator, rule validator, base rule pack seed, grant/constraint evaluation, authority-token shape helpers, approval state machine. **No I/O.** Imported by `apps/core`. |
| `packages/capability-sdk/src/` | `defineCapability()`, zod→JSON-Schema, manifest + worker-entry codegen, `AdapterContext` type, testkit (`runAction`). |
| `packages/capability-sdk/lint/` | The `capabilities/**` security-lint rule module, imported by `scripts/lint.mjs` and runnable standalone. |

### New Kernel-internal modules (`apps/core/src/kernel/`)

| Path | Owns |
|---|---|
| `capability-registry/` | manifest storage/validation/versioning/probation/lookup |
| `policy/` | wraps `@jarvis/permissions` evaluator; rule store I/O; `PolicyQuery` assembly |
| `permission/` | grants I/O; authority-token minting (Redis); approval + dual-control workflow; freshness-barrier helper |
| `executor/` | the pipeline; `agency.invocations` projection + folding; resource leases; saga recovery |
| `credential-broker/` | material load; `mint()`; redaction filter; `agency.credential_grants` audit |
| `sentinel/` | detector service; the 12 detectors; alert emission |
| `mode/guardian-playbook.ts` | the six-step playbook + wiring to the `GUARDIAN` transition |

### New deployables

| Path | What |
|---|---|
| `apps/adapter-host/` | worker-spawn runtime; IPC contract; `worker+container` path; pool for AMBIENT/LOW |
| `apps/labs/` | ephemeral-Docker sandbox lifecycle; build+test+analyse a `CapabilityDraftProposal`; `LabsRunReport` |

### Capability definitions (`capabilities/<id>/`)

`filesystem/`, `github/`, `docker/`, `terminal/`, `windows/`, `browser/`,
`web/`, `telemetry/` — each `definition.ts` (`defineCapability`), generated
`manifest.json` + `worker.entry.ts`, `*.test.ts`, `*.integration.test.ts`.
`email/`, `calendar/`, `scalesmiths/`, `smart-home/`, `mobile/`, `robotics/` —
`definition.ts` only, `execute` throws `NOT_IMPLEMENTED`, registered
`active: false`.

Plus the Guardian/Sentinel restrict-only capabilities under
`capabilities/`: `permission/` (`tighten_all`), `agency-control/`
(`suspend_autonomous_external`, `resume`), `audit/` (`snapshot`), `node/`
(`isolate`), `notify/` (`operator`).

### Contracts (`packages/contracts/src/`)

New `agency.ts`; extend `capability.ts`, `policy.ts`, `permission.ts`,
`proposal.ts`, `event-names.ts`; barrel in `index.ts`.

### Schema

`packages/persistence/src/migrations/0008_agency.sql` + migration test in
`apps/core/test/`.

---

## Task 1 — Contracts, events, schema, validation

**Files:**
- Create: `packages/contracts/src/agency.ts`
- Modify: `packages/contracts/src/capability.ts`, `policy.ts`, `permission.ts`,
  `proposal.ts`, `event-names.ts`, `index.ts`
- Create: `packages/persistence/src/migrations/0008_agency.sql`
- Create: `apps/core/test/0008-agency-migration.integration.test.ts`
- Modify: `packages/validation/src/payloads.schema.ts`
- Create: `packages/validation/src/agency-payloads.test.ts`

**Interfaces — Produces:**
- `agency.ts`: `InvocationState`, `LEGAL_INVOCATION_TRANSITIONS`,
  `TERMINAL_INVOCATION_STATES`, `InvocationLifecycle`, `CredentialHandle`,
  `AdapterContext`, `VerificationReport`, `RollbackReport`, `PredictedEffect`,
  `CapabilityDraftProposal`, `LabsRunReport` (spec §3.2)
- `capability.ts` extensions: `Capability.{description,provider,
  executionEnvironment,auditPolicy,privacyRequirements}`,
  `CapabilityAction.{approvalPolicy,timeoutMs,verificationStrategy,
  rollbackStrategy,idempotencyKeySelector,confirmationPhrase,declaredEgress}`,
  `VerificationStrategy`, `RollbackStrategy` (spec §3.1)
- `policy.ts`: `PolicyPredicate` union, `PolicyContext` extensions (spec §3.3)
- `permission.ts`: `Grant.{resourceConstraints,nodeConstraints,timeWindows}`,
  `ResourceConstraint`, `AuthorityToken.principalId`,
  `ApprovalRequest.{approvalEvidence,confirmationPhraseHash}` (spec §3.4)
- `EventNames.*` for every row in spec §4
- schema `agency` with the 11 tables of spec §5

- [ ] **Step 1: Write the failing contract test.**
`packages/contracts/src/agency.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  LEGAL_INVOCATION_TRANSITIONS,
  TERMINAL_INVOCATION_STATES,
  type InvocationState,
} from './agency.ts';

describe('invocation lifecycle table', () => {
  it('every non-terminal state has at least one legal successor', () => {
    for (const [state, next] of Object.entries(LEGAL_INVOCATION_TRANSITIONS)) {
      if ((TERMINAL_INVOCATION_STATES as readonly string[]).includes(state)) {
        expect(next).toEqual([]);
      } else {
        expect(next.length).toBeGreaterThan(0);
      }
    }
  });
  it('terminal states are exactly the documented set', () => {
    expect([...TERMINAL_INVOCATION_STATES].sort()).toEqual(
      ['ABORTED','COMPLETED','DENIED','FAILED','PARTIALLY_COMPLETED','REJECTED','ROLLED_BACK','VERIFICATION_FAILED'].sort(),
    );
  });
  it('PROPOSED only goes to VALIDATED or REJECTED', () => {
    expect(LEGAL_INVOCATION_TRANSITIONS['PROPOSED' as InvocationState].sort())
      .toEqual(['REJECTED','VALIDATED']);
  });
  it('COMPENSATING can only reach PARTIALLY_COMPLETED', () => {
    expect(LEGAL_INVOCATION_TRANSITIONS['COMPENSATING' as InvocationState])
      .toEqual(['PARTIALLY_COMPLETED']);
  });
});
```

- [ ] **Step 2: Run it — FAIL** (`agency.ts` not found).
`node_modules/.bin/vitest run packages/contracts/src/agency.test.ts`

- [ ] **Step 3: Write `agency.ts`.** All types from spec §3.2. The transition
table (derive from spec §3.2 / ADR-0025 §1):
```ts
export type InvocationState =
  | 'PROPOSED' | 'VALIDATED' | 'POLICY_CHECKED'
  | 'AWAITING_APPROVAL' | 'APPROVED' | 'SIMULATING' | 'SIMULATED'
  | 'EXECUTING' | 'VERIFYING' | 'COMPLETED'
  | 'REJECTED' | 'DENIED' | 'ABORTED' | 'FAILED' | 'VERIFICATION_FAILED'
  | 'ROLLING_BACK' | 'ROLLED_BACK' | 'COMPENSATING' | 'PARTIALLY_COMPLETED';

export const TERMINAL_INVOCATION_STATES = [
  'REJECTED','DENIED','ABORTED','FAILED','VERIFICATION_FAILED',
  'ROLLED_BACK','PARTIALLY_COMPLETED','COMPLETED',
] as const;

export const LEGAL_INVOCATION_TRANSITIONS: Record<InvocationState, InvocationState[]> = {
  PROPOSED:          ['VALIDATED','REJECTED'],
  VALIDATED:         ['POLICY_CHECKED','REJECTED'],
  POLICY_CHECKED:    ['AWAITING_APPROVAL','APPROVED','DENIED'],  // APPROVED = policy ALLOW short-circuit
  AWAITING_APPROVAL: ['APPROVED','DENIED'],
  APPROVED:          ['SIMULATING','EXECUTING','ABORTED'],
  SIMULATING:        ['SIMULATED','FAILED','ABORTED'],
  SIMULATED:         ['EXECUTING','ABORTED','DENIED'],           // re-approval after sim can deny
  EXECUTING:         ['VERIFYING','FAILED','COMPENSATING'],
  VERIFYING:         ['COMPLETED','VERIFICATION_FAILED','ROLLING_BACK'],
  ROLLING_BACK:      ['ROLLED_BACK','VERIFICATION_FAILED'],
  COMPENSATING:      ['PARTIALLY_COMPLETED'],
  COMPLETED: [], REJECTED: [], DENIED: [], ABORTED: [], FAILED: [],
  VERIFICATION_FAILED: [], ROLLED_BACK: [], PARTIALLY_COMPLETED: [],
};
```

- [ ] **Step 4: Extend `capability.ts` / `policy.ts` / `permission.ts` /
`proposal.ts`** exactly per spec §3.1/§3.3/§3.4/§3.5. Add every `EventNames`
constant from spec §4 (grammar `jarvis.agency.*` / `jarvis.security.*`). Barrel
all new exports in `index.ts`. Run `node_modules/.bin/tsc -p tsconfig.json` —
expect 0 errors.

- [ ] **Step 5: Write `0008_agency.sql`.** All 11 tables from spec §5. Follow
`0005_atlas.sql` conventions: `create schema agency;`, per-table
`principal_id text not null` where the spec lists it, `create role agency_rw`,
`grant` only `agency.*` to `agency_rw` (no cross-schema grant), partition
`agency.invocations` is **not** required (bounded by retention) but add
`created_at` + an index on `(state)` and `(correlation_id)`. `policy_rules` is
append-only: `primary key (id, version)`.

- [ ] **Step 6: Migration integration test** (`JARVIS_IT=1`), mirroring
`apps/core/test/` MK.46 migration tests:
```ts
it('0008 applies and agency_rw cannot read other schemas', async () => {
  await applyMigrations(sql);
  const tables = await sql`select table_name from information_schema.tables where table_schema = 'agency'`;
  expect(tables.map(r => r.table_name)).toEqual(expect.arrayContaining(
    ['capabilities','grants','policy_rules','invocations','credential_grants','approvals','resource_leases']));
  await expect(sql`set role agency_rw; select * from atlas.entities limit 1`).rejects.toThrow();
});
```

- [ ] **Step 7: Payload schemas + test.** In `payloads.schema.ts` add a zod
schema per `jarvis.agency.*` / `jarvis.security.*` event keyed by the
`EventNames` constant. `agency-payloads.test.ts`: for each, a valid payload
passes and a missing-required-field payload fails (pattern:
`packages/validation` MK.47 `perception-payloads.test.ts`).

- [ ] **Step 8: Verify + commit.**
`tsc` 0, `node scripts/lint.mjs` clean, `vitest run packages/contracts packages/validation`.
```bash
git add packages/contracts packages/persistence packages/validation apps/core/test
git commit -m "feat(mk47-hephaestus): agency contracts, events, 0008 schema, payload validation"
```

---

## Task 2 — Capability SDK + `capabilities/` scaffold + security lint

**Files:**
- Create: `packages/capability-sdk/{package.json,tsconfig.json,src/index.ts,
  src/define.ts,src/codegen.ts,src/context.ts,src/testkit.ts,src/schema.ts}`
- Create: `packages/capability-sdk/lint/capabilities-lint.mjs`
- Create: `packages/capability-sdk/src/*.test.ts`
- Modify: `scripts/lint.mjs` (import + run the capabilities rule set)
- Create: `capabilities/_sample/definition.ts` (a throwaway used only by tests;
  gitignored output for generated files or committed — commit them)
- Modify: `pnpm-workspace.yaml` already globs `capabilities/*` — add
  `capabilities/_sample` note or keep sample under `packages/capability-sdk/fixtures/`

**Interfaces — Produces:**
- `defineCapability(def): CapabilityModule` — validates the def, returns
  `{ manifest: Capability, actions: Record<string, ActionImpl> }`
- `generateManifest(def) → Capability` (JSON-serializable; zod→JSON Schema via
  `zod-to-json-schema` **inlined** — do not add the dep if install is
  unreliable; a minimal converter covering object/string/number/enum/array/
  optional is acceptable and tested)
- `generateWorkerEntry(def) → string` (TS source the Adapter Host spawns)
- `AdapterContext` (re-export from contracts `agency.ts`), `runAction(mod,
  action, input, opts) → { output, verify, rollback }` testkit
- `lintCapabilities(files) → LintFinding[]` — the rule set of ADR-0030

**Interfaces — Consumes:** `@jarvis/contracts` (`Capability`, `RiskClass`,
`agency.ts`).

- [ ] **Step 1: Failing test — `define.test.ts`:**
```ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineCapability } from './define.ts';

const base = {
  id: 'capabilities.sample', version: '1.0.0', description: 'x', provider: 'sample',
  executionEnvironment: 'worker' as const,
  auditPolicy: { hashInput: true, recordOutput: 'summary' as const },
  privacyRequirements: { maxContentPrivacyClass: 'INTERNAL' as const },
};

it('rejects a reversible side-effecting action with no rollback', () => {
  expect(() => defineCapability({ ...base, actions: {
    do_it: {
      input: z.object({}), output: z.object({}),
      risk: 'MEDIUM', reversible: true, idempotent: true, requiredScopes: ['sample.write'],
      approvalPolicy: 'default', timeoutMs: 1000,
      verificationStrategy: { kind: 'world-read', adapterRef: 'verifyDoIt' },
      sideEffects: ['writes a thing'],
      async execute() { return {}; }, async verify() { return { verified: true, checks: [] }; },
    },
  }})).toThrow(/rollback/i);
});

it('rejects a CRITICAL action with no confirmationPhrase', () => {
  expect(() => defineCapability({ ...base, actions: {
    nuke: { input: z.object({}), output: z.object({}), risk: 'CRITICAL', reversible: false,
      idempotent: false, requiredScopes: ['sample.nuke'], approvalPolicy: 'default', timeoutMs: 1000,
      verificationStrategy: { kind: 'world-read', adapterRef: 'v' }, sideEffects: ['deletes prod'],
      async execute() { return {}; }, async verify() { return { verified: true, checks: [] }; } },
  }})).toThrow(/confirmationPhrase/i);
});

it('generates a manifest whose inputSchema is JSON-Schema, not a zod object', () => {
  const m = defineCapability({ ...base, actions: {
    ping: { input: z.object({ host: z.string() }), output: z.object({ ok: z.boolean() }),
      risk: 'AMBIENT', reversible: false, idempotent: true, requiredScopes: [],
      approvalPolicy: 'default', timeoutMs: 1000,
      verificationStrategy: { kind: 'world-read', adapterRef: 'v' }, sideEffects: [],
      async execute() { return { ok: true }; }, async verify() { return { verified: true, checks: [] }; } },
  }}).manifest;
  expect(m.actions[0].inputSchema).toMatchObject({ type: 'object', properties: { host: { type: 'string' } } });
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement `schema.ts`** (minimal zod→JSON-Schema),
`define.ts` (validation: risk floors from spec §7, `verify` presence per
action, `rollback` presence per reversible+sideEffects, `confirmationPhrase`
presence per CRITICAL, intrusion-verb denylist over `sideEffects`, id/version
regex), `codegen.ts`, `context.ts`, `testkit.ts`, `index.ts`.

- [ ] **Step 4: Failing test — `capabilities-lint.test.ts`.** One fixture file
per rule (a `process.env.SECRET` read, a bare `fetch(`, an action missing
`verify`, `child_process` in a non-terminal provider, `sideEffects: ['exploit
the host']`, an id `Capabilities.Bad`). Assert `lintCapabilities([fixture])`
returns a finding with the expected `rule` id for each.

- [ ] **Step 5: Implement `lint/capabilities-lint.mjs`** (regex/AST rules of
ADR-0030). Wire into `scripts/lint.mjs`: after the existing wall checks, if
any staged/all `capabilities/**/*.ts` file exists, run `lintCapabilities` and
fail `lint` on any finding.

- [ ] **Step 6: Verify + commit.** `tsc` 0, `node scripts/lint.mjs` clean
(the sample capability must itself pass the lint), `vitest run packages/capability-sdk`.
```bash
git commit -m "feat(mk47-hephaestus): @jarvis/capability-sdk — defineCapability, codegen, security lint"
```

---

## Task 3 — Policy Engine (`@jarvis/permissions` — pure)

**Files:**
- Create: `packages/permissions/{package.json,tsconfig.json,src/index.ts}`
- Create: `packages/permissions/src/policy/{ast.ts,evaluate.ts,validate-rule.ts,
  base-pack.ts}`
- Create: `packages/permissions/src/policy/*.test.ts`

**Interfaces — Produces:**
- `evaluatePolicy(query: PolicyQuery, rules: PolicyRule[]): PolicyDecision` —
  pure; implements spec §3 evaluation order (hard caps → rules by priority,
  DENY>REQUIRE_APPROVAL>ALLOW at equal priority → fail-closed default)
- `validatePolicyRule(rule: PolicyRule): { ok: true } | { ok: false; errors: string[] }`
  — rejects a non-DENY rule referencing `context.llmRecommendation`; rejects a
  rule that yields ALLOW gated on `jarvisMode` when the mode-free eval is
  stricter (differential check)
- `evalPredicate(node: PolicyPredicate, query: PolicyQuery): boolean` — total;
  operator set from ADR-0026 (`and/or/not/eq/ne/lt/lte/gt/gte/in/not-in/
  matches(RE2)/path-under/time-window/scope-held/risk-at-least`)
- `BASE_RULE_PACK: PolicyRule[]` — the 16 rows of ADR-0026

**Interfaces — Consumes:** `@jarvis/contracts` (`PolicyQuery`, `PolicyRule`,
`PolicyDecision`, `PolicyPredicate`, `RiskClass`, `PolicyVerdict`).

- [ ] **Step 1: Failing test — `evaluate.test.ts`:**
```ts
import { describe, it, expect } from 'vitest';
import { evaluatePolicy } from './evaluate.ts';
import { BASE_RULE_PACK } from './base-pack.ts';

const q = (over: Partial<any> = {}): any => ({
  actor: { kind: 'agent', id: 'a1', onBehalfOf: 'p1', heldScopes: ['github.branch.write'] },
  action: { capabilityId: 'capabilities.github', action: 'create_branch', riskClass: 'MEDIUM', requiredScopes: ['github.branch.write'] },
  context: { operatorReachable: true, degradation: 'nominal', derivedFromUntrusted: false,
    hostTrustTier: 'owned-secure', jarvisMode: 'ENGAGED', authTrustLevel: 'trusted', authMethod: 'token',
    resourceRef: 'octo/repo', originNodeId: 'srv', recentDenialCount: 0, now: '2026-09-03T12:00:00Z' },
  ...over,
});

it('untrusted-derived above LOW is DENY regardless of rules', () => {
  const d = evaluatePolicy(q({ context: { ...q().context, derivedFromUntrusted: true } }), BASE_RULE_PACK);
  expect(d.verdict).toBe('DENY');
  expect(d.firedRuleIds).toContain('hardcap.untrusted');
});

it('missing required scope is DENY, never REQUIRE_APPROVAL', () => {
  const d = evaluatePolicy(q({ actor: { ...q().actor, heldScopes: [] } }), BASE_RULE_PACK);
  expect(d.verdict).toBe('DENY');
});

it('GUARDIAN + CRITICAL is DENY', () => {
  const d = evaluatePolicy(q({
    action: { ...q().action, riskClass: 'CRITICAL' },
    context: { ...q().context, jarvisMode: 'GUARDIAN' },
  }), BASE_RULE_PACK);
  expect(d.verdict).toBe('DENY');
});

it('create_branch with scope held and base pack -> ALLOW', () => {
  expect(evaluatePolicy(q(), BASE_RULE_PACK).verdict).toBe('ALLOW');
});

it('unconfigured MEDIUM (no rules) -> DENY (fail closed)', () => {
  expect(evaluatePolicy(q(), []).verdict).toBe('DENY');
});

it('unconfigured AMBIENT read (no rules) -> ALLOW', () => {
  expect(evaluatePolicy(q({ action: { ...q().action, riskClass: 'AMBIENT', requiredScopes: [] },
    actor: { ...q().actor, heldScopes: [] } }), []).verdict).toBe('ALLOW');
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement `ast.ts` + `evalPredicate`** (total; `matches` uses a
RE2-style safe subset — reject `\1` backrefs and `(?=` lookahead at parse;
length-cap the pattern). `path` resolves dotted paths of `query` only; unknown
path ⇒ `false` (never throw).

- [ ] **Step 4: Implement `evaluate.ts`** per spec §3 order. Emit
`firedRuleIds` including synthetic `hardcap.*` ids; deterministic `rationale`.

- [ ] **Step 5: Implement `validate-rule.ts`** and `base-pack.ts` (the 16
rows). Each base rule gets a `*.test.ts` case asserting its ALLOW/DENY on a
representative query.

- [ ] **Step 6: Determinism property test — `evaluate.property.test.ts`:**
```ts
it('same query -> same decision, 5000 random inputs', () => {
  for (let i = 0; i < 5000; i++) {
    const query = randomPolicyQuery(i);         // seeded RNG over the field domains
    const a = evaluatePolicy(query, BASE_RULE_PACK);
    const b = evaluatePolicy(structuredClone(query), BASE_RULE_PACK);
    expect(a).toEqual(b);
  }
});
it('no base or seeded rule references llmRecommendation with a non-DENY effect', () => {
  for (const r of BASE_RULE_PACK) {
    const refs = JSON.stringify(r.predicate).includes('context.llmRecommendation');
    if (refs) expect(r.effect).toBe('DENY');
  }
});
```

- [ ] **Step 7: Verify + commit.**
```bash
git commit -m "feat(mk47-hephaestus): @jarvis/permissions Policy Engine — total AST evaluator, rule validator, base pack"
```

---

## Task 4 — Permission Engine (`@jarvis/permissions` pure + `apps/core/src/kernel/permission/`)

**Files:**
- Create: `packages/permissions/src/permission/{constraints.ts,approval.ts,
  token.ts}` + tests
- Create: `apps/core/src/kernel/permission/{permission-manager.ts,
  grant-store.ts,token-cache.ts,index.ts}` + tests
- Modify: `apps/core/src/kernel/lifecycle/kernel.ts` (register the component)

**Interfaces — Produces (pure):**
- `checkResourceConstraints(constraints: ResourceConstraint[], input: unknown,
  action: string): { ok: true } | { ok: false; failed: ResourceConstraint }`
- `approvalReducer(state: ApprovalRequest, ev: ApprovalEvent): ApprovalRequest`
  — pending → approved/rejected/expired; DUAL needs `receivedAuthorisations === 2`
  with distinct `kinds` (`operator` + `confirmation`)
- `mintAuthorityToken(params): AuthorityToken` — binds `invocationId`,
  `grantId`, `grantVersion`, `principalId`; `expiresAt = now + 120s`

**Interfaces — Produces (Kernel):**
- `PermissionManager.issueGrant / revokeGrant / modifyGrant`
- `PermissionManager.decideApproval(invocationId, riskClass, simulatedEffect?)`
  → `{ state: 'approved' | 'denied' | 'awaiting'; requestId }`
- `PermissionManager.freshnessCheck(sql, grantId, grantVersion)` — the
  `FOR SHARE` re-read (spec §6 step 8 / ADR-0027); returns `ok|stale|revoked|expired`
- `PermissionManager.mint(invocationId, grantId, scopes, mode)` — persists to
  `token-cache` (Redis) single-use

**Interfaces — Consumes:** Task 3, `@jarvis/contracts` permission types,
`@jarvis/persistence`, the Notification Manager (for surfacing approvals), the
Identity Manager (`AuthContext` for `authTrustLevel`, `sessionId`).

- [ ] **Step 1: Failing pure tests — `constraints.test.ts`, `approval.test.ts`,
`token.test.ts`:**
```ts
// constraints
it('path-prefix constraint denies a write outside the prefix', () => {
  const r = checkResourceConstraints(
    [{ kind: 'path-prefix', value: '/ws/' }], { path: '/etc/passwd' }, 'write_file');
  expect(r.ok).toBe(false);
});
// approval — dual control
it('DUAL stays pending with only the operator approve', () => {
  let s = newApproval({ riskClass: 'CRITICAL', requiredAuthorisations: 2 });
  s = approvalReducer(s, { kind: 'authorise', by: 'operator', at: T });
  expect(s.state).toBe('pending');
});
it('DUAL approves with operator approve + matching confirmation phrase, same session', () => {
  let s = newApproval({ riskClass: 'CRITICAL', requiredAuthorisations: 2, sessionId: 's1' });
  s = approvalReducer(s, { kind: 'authorise', by: 'operator', at: T, sessionId: 's1', authTrustLevel: 'verified' });
  s = approvalReducer(s, { kind: 'confirm', phraseHash: H, at: T, sessionId: 's1', authTrustLevel: 'verified' });
  expect(s.state).toBe('approved');
});
it('DUAL rejects a confirmation from a different session', () => {
  let s = newApproval({ riskClass: 'CRITICAL', requiredAuthorisations: 2, sessionId: 's1' });
  s = approvalReducer(s, { kind: 'authorise', by: 'operator', at: T, sessionId: 's1', authTrustLevel: 'verified' });
  s = approvalReducer(s, { kind: 'confirm', phraseHash: H, at: T, sessionId: 's2', authTrustLevel: 'verified' });
  expect(s.state).toBe('pending');   // ignored, not counted
});
// token
it('mints a 120s single-use token bound to the invocation', () => {
  const t = mintAuthorityToken({ invocationId: 'i1', grantId: 'g1', grantVersion: 3, principalId: 'p1', scopes: ['x'], mode: 'full', now: T });
  expect(Date.parse(t.expiresAt) - Date.parse(T)).toBe(120_000);
  expect(t.invocationId).toBe('i1');
});
```

- [ ] **Step 2: Run — FAIL. Step 3: Implement the pure modules.**

- [ ] **Step 4: Failing Kernel test — `permission-manager.integration.test.ts`
(`JARVIS_IT=1`):** issue a grant; `freshnessCheck` with the current version ⇒
`ok`; `revokeGrant`; `freshnessCheck` again ⇒ `revoked`. Approval timeout:
`decideApproval` then advance the fake clock past the TTL ⇒ the request is
`expired` and (no standing grant) the decision is `denied`.

- [ ] **Step 5: Implement `permission-manager.ts` + stores.** `token-cache`
uses the existing Redis client wrapper if present, else an in-process
`Map` with TTL behind the same interface (mirror MK.43's optional-redis
pattern). Register in `kernel.ts` as component #9; `health.register({ subsystem:
'permission-engine', critical: true, dependsOn: ['postgres'] })`.

- [ ] **Step 6: Verify + commit.**
```bash
git commit -m "feat(mk47-hephaestus): Permission Engine — grants, resource constraints, authority tokens, approval + dual control, freshness barrier"
```

---

## Task 5 — Capability Registry (Kernel #10)

**Files:**
- Create: `apps/core/src/kernel/capability-registry/{registry.ts,
  manifest-validate.ts,store.ts,index.ts}` + tests
- Modify: `apps/core/src/kernel/lifecycle/kernel.ts`

**Interfaces — Produces:**
- `CapabilityRegistry.register(manifest, adapterArtifactHash, registeredBy):
  { ok: true; version } | { ok: false; code; detail }`
- `manifest-validate.ts` `validateManifest(m): ValidationResult` — risk floors
  (spec §7), `verify` per action, `rollback` per reversible+sideEffects,
  `confirmationPhrase` per CRITICAL, intrusion-verb denylist, id/version regex,
  every `ActionRef` resolvable in the manifest, `declaredEgress` present if the
  adapter source uses `ctx.http` (checked at Task 8 for real adapters)
- `CapabilityRegistry.lookup(id, version?) → Capability | undefined`
- `CapabilityRegistry.enterProbation(id) / clearProbation(id)` — sets effective
  `riskClass = max(declared, HIGH)` + `approvalPolicy = 'always'` until cleared
- emits `jarvis.agency.capability.registered / .deprecated / .probation.*`

**Interfaces — Consumes:** Task 1 (`Capability`), Task 2 (`lintCapabilities`
for source-level checks), `@jarvis/persistence` (`agency.capabilities`,
`agency.capability_versions`).

- [ ] **Step 1: Failing test — `manifest-validate.test.ts`:**
```ts
it('rejects a manifest with a reversible+side-effecting action and no rollbackStrategy', () => {
  const r = validateManifest(fixtureManifest({ reversible: true, sideEffects: ['x'], rollbackStrategy: undefined }));
  expect(r.ok).toBe(false); expect(r.errors[0].code).toBe('ROLLBACK_REQUIRED');
});
it('rejects a manifest whose sideEffects contain an intrusion verb', () => {
  const r = validateManifest(fixtureManifest({ sideEffects: ['port-scan the subnet'] }));
  expect(r.ok).toBe(false); expect(r.errors[0].code).toBe('OFFENSIVE_FORBIDDEN');
});
it('rejects a CRITICAL action with no confirmationPhrase', () => {
  const r = validateManifest(fixtureManifest({ riskClass: 'CRITICAL', confirmationPhrase: undefined }));
  expect(r.ok).toBe(false);
});
it('accepts the sample manifest', () => {
  expect(validateManifest(sampleManifest).ok).toBe(true);
});
```

- [ ] **Step 2: Run — FAIL. Step 3: Implement `manifest-validate.ts`,
`store.ts`, `registry.ts`.**

- [ ] **Step 4: Failing test — `registry.integration.test.ts`:** register the
sample; `lookup` returns it; register again with a bumped version ⇒ both
versions stored, `latest_version` updated; `register` of a manifest that fails
validation ⇒ `{ ok: false, code }` and **no** row written; `enterProbation` ⇒
`lookup` reports effective `riskClass: HIGH` + `approvalPolicy: 'always'`.

- [ ] **Step 5: Implement + register in `kernel.ts` (#10).**

- [ ] **Step 6: Verify + commit.**
```bash
git commit -m "feat(mk47-hephaestus): Capability Registry — manifest validation, versioning, probation"
```

---

## Task 6 — Capability Executor + action lifecycle + saga recovery

**Files:**
- Create: `apps/core/src/kernel/executor/{executor.ts,lifecycle.ts,
  invocation-store.ts,lease.ts,verify-runner.ts,saga.ts,index.ts}` + tests
- Modify: `apps/core/src/kernel/lifecycle/kernel.ts` (wire the Executor service;
  cold-start saga scan)

**Interfaces — Produces:**
- `Executor.invoke(proposal: CapabilityInvocationProposal, origin: EventActor):
  Promise<InvocationResult>` — runs the full spec §6 sequence
- `lifecycle.ts` `advance(current, next): { ok: true } | { ok: false }` — guards
  against non-`LEGAL_INVOCATION_TRANSITIONS` edges; **throws** on an illegal
  transition (a bug, not a runtime condition)
- `invocation-store.ts` — folds `agency.invocations` from
  `jarvis.agency.invocation.*` events; `orphaned(): InvocationLifecycle[]` for
  cold start (EXECUTING/SIMULATING/ROLLING_BACK/COMPENSATING with no terminal)
- `verify-runner.ts` `runVerification(strategy, adapter, readCred): VerificationReport`
  — executes `verificationStrategy` (spec §3.1 kinds) against the world
- `lease.ts` `acquire(sql, resourceKey, invocationId) / release` — `FOR UPDATE`
- `saga.ts` `compensate(invocation): void` — completed steps in reverse

**Interfaces — Consumes:** Tasks 3–5, the Validator (`@jarvis/validation`),
Credential Broker (Task 7 — until then, a `FakeBroker` in tests), Adapter Host
(Task 8 — until then, an in-test `FakeAdapterRunner`), Event Manager, State
Manager, Notification Manager, `agency` schema.

> **Build order note:** implement Task 6 against `FakeBroker` +
> `FakeAdapterRunner` interfaces defined here; Tasks 7 and 8 provide the real
> implementations behind the same interface. This keeps 6 independently
> testable.

- [ ] **Step 1: Failing test — `executor.lifecycle.test.ts` (in-process, fakes):**
```ts
it('a validator reject ends at REJECTED and emits invocation.rejected (SECURITY)', async () => {
  const { executor, events } = harness({ validator: () => ({ ok: false, rejections: [{ code: 'SCHEMA', detail: 'x' }], derivedFromUntrusted: false }) });
  const r = await executor.invoke(proposalFor('capabilities.filesystem', 'write_file', { path: '/ws/a', content: 'x' }), agentActor);
  expect(r.outcome).toBe('rejected');
  expect(events.typesInOrder()).toEqual(['jarvis.agency.invocation.proposed','jarvis.agency.invocation.rejected']);
  expect(events.byType('jarvis.agency.invocation.rejected')[0].retentionClass).toBe('SECURITY');
});

it('a policy DENY ends at DENIED, never mints a token, never calls the adapter', async () => {
  const { executor, broker, adapter } = harness({ policy: () => ({ verdict: 'DENY', firedRuleIds: ['r'], rationale: 'no' }) });
  const r = await executor.invoke(proposalFor('capabilities.filesystem','write_file',{path:'/ws/a',content:'x'}), agentActor);
  expect(r.outcome).toBe('denied');
  expect(broker.mintCalls).toBe(0);
  expect(adapter.executeCalls).toBe(0);
});

it('happy path: PROPOSED->...->COMPLETED with a world-verified effect', async () => {
  const { executor, events } = harness({ policy: () => allow, verify: () => ({ verified: true, checks: [] }) });
  const r = await executor.invoke(proposalFor('capabilities.filesystem','write_file',{path:'/ws/a',content:'x'}), agentActor);
  expect(r.outcome).toBe('verified');
  expect(events.typesInOrder()).toEqual([
    'jarvis.agency.invocation.proposed','jarvis.agency.invocation.validated',
    'jarvis.agency.invocation.policy_checked','jarvis.agency.invocation.started',
    'jarvis.agency.invocation.verified',
  ]);
});

it('verification failure on a reversible action rolls back and re-verifies the undo', async () => {
  const { executor, events } = harness({ policy: () => allow, verify: () => ({ verified: false, checks: [{ name: 'hash', ok: false, detail: '' }] }) });
  const r = await executor.invoke(proposalFor('capabilities.filesystem','write_file',{path:'/ws/a',content:'x'}), agentActor);
  expect(r.outcome).toBe('rolled_back');
  expect(events.typesInOrder()).toContain('jarvis.agency.invocation.rolled_back');
});

it('the adapter return value cannot flip state to COMPLETED — only verificationStrategy can', async () => {
  const { executor } = harness({ policy: () => allow,
    adapterExecute: () => ({ status: 200, ok: true }),      // adapter claims success
    verify: () => ({ verified: false, checks: [] }) });     // world says no
  const r = await executor.invoke(proposalFor('capabilities.filesystem','write_file',{path:'/ws/a',content:'x'}), agentActor);
  expect(r.outcome).not.toBe('verified');
});
```

- [ ] **Step 2: Run — FAIL. Step 3: Implement `lifecycle.ts` + `executor.ts`**
per spec §6 exactly. Order is normative; each transition calls
`advance()` then emits its event (event append and the projection row write
share a transaction for `started` / terminal states).

- [ ] **Step 4: Failing test — freshness barrier & lease.**
`executor.freshness.integration.test.ts` (`JARVIS_IT=1`): stub the Permission
Engine so the grant version increments between `POLICY_CHECKED` and the started
transaction ⇒ outcome `aborted`, `invocation.aborted` (SECURITY) emitted, no
`started`, `broker.mintCalls === 0`. Second test: two concurrent `invoke`s for
the same `resourceKey` ⇒ one acquires the lease, the other waits then proceeds
(serialised), never interleaved.

- [ ] **Step 5: Failing test — restart saga.** `executor.saga.integration.test.ts`:
run a 3-step capability, kill after step 2's `step_completed`, restart the
Executor, assert it emits `compensated` for steps 2 then 1 (reverse) and ends
`PARTIALLY_COMPLETED`.

- [ ] **Step 6: Implement `lease.ts`, `saga.ts`, `verify-runner.ts`,
`invocation-store.ts`.** Wire cold-start `orphaned()` scan into `kernel.ts`
lifecycle (after State Manager replay, before ingress open).

- [ ] **Step 7: Verify + commit.**
```bash
git commit -m "feat(mk47-hephaestus): Capability Executor — 14-state lifecycle, freshness barrier, leases, verify runner, saga recovery"
```

---

## Task 7 — Credential Broker

**Files:**
- Create: `apps/core/src/kernel/credential-broker/{broker.ts,material-store.ts,
  derive/{github.ts,docker-proxy.ts,static.ts},redact.ts,index.ts}` + tests
- Modify: `apps/core/src/kernel/executor/executor.ts` (swap `FakeBroker` for the
  real `CredentialBroker` behind the existing interface)
- Modify: `apps/core/src/kernel/lifecycle/kernel.ts`

**Interfaces — Produces:**
- `CredentialBroker.mint(params: { invocationId; capabilityId; action;
  resourceRef; mode }): Promise<CredentialHandle>` — `derived` where a
  `derive/*` handler exists for `provider`, else `wrapped-static`; `dry-run` ⇒
  read-only/sandbox
- `CredentialBroker.redeem(handleId): InternalCredential` — **Adapter-Host-side
  only**; for `derived`, returns a request-signer, not a string
- `redact.ts` `makeRedactor(secretFingerprints: string[]): (s: string) => string`
- emits `jarvis.security.credential.minted` (SECURITY; scope + TTL + kind only)

**Interfaces — Consumes:** config (keychain path / secrets file), Task 6
interface, `agency.credential_grants`.

- [ ] **Step 1: Failing test — `broker.test.ts`:**
```ts
it('mint(dry-run) yields a read-only handle', async () => {
  const b = new CredentialBroker(fakeMaterial);
  const h = await b.mint({ invocationId: 'i1', capabilityId: 'capabilities.github', action: 'create_branch', resourceRef: 'octo/repo', mode: 'dry-run' });
  expect(h.mode).toBe('dry-run');
  const c = b.redeem(h.handleId);
  expect(c.readOnly).toBe(true);
});
it('a derived handle never exposes the secret string to redeem() callers', async () => {
  const b = new CredentialBroker(fakeGithubApp);
  const h = await b.mint({ invocationId: 'i1', capabilityId: 'capabilities.github', action: 'create_branch', resourceRef: 'octo/repo', mode: 'full' });
  const c = b.redeem(h.handleId);
  expect(JSON.stringify(c)).not.toContain(fakeGithubApp.privateKey);
  expect(typeof c.signRequest).toBe('function');
});
it('mint emits credential.minted with scope + TTL but no material', async () => {
  const { broker, events } = harness();
  await broker.mint({ invocationId: 'i1', capabilityId: 'capabilities.web', action: 'get', resourceRef: 'https://example.com', mode: 'full' });
  const e = events.byType('jarvis.security.credential.minted')[0];
  expect(e.retentionClass).toBe('SECURITY');
  expect(JSON.stringify(e.payload)).not.toContain('secret');
});
it('the redactor masks a leaked secret and the redaction is detectable', () => {
  const r = makeRedactor(['abc123deadbeef']);
  expect(r('token=abc123deadbeef done')).toBe('token=«redacted» done');
});
```

- [ ] **Step 2: Run — FAIL. Step 3: Implement.** `derive/github.ts` builds an
app JWT → installation token scoped to `resourceRef` repos + the action's
permission set (use a fake in tests; real `@octokit/auth-app` behind an
interface, added only if install is reliable — else a documented
`wrapped-static` fallback with the PAT). `derive/docker-proxy.ts` returns a
signed short-TTL token for the socket proxy with a command allowlist.
`static.ts` returns a `SecretBox` exposing only `use(fn)`.

- [ ] **Step 4: Failing test — leak path.**
`executor.credential-leak.integration.test.ts`: a fake adapter that `ctx.log`s
its secret ⇒ the emitted log event contains `«redacted»` and a
`jarvis.security.alert.elevated` (`cred.leak-attempt`) is raised;
`agency.invocations.input_hash` is set and no `input` column exists / is null.

- [ ] **Step 5: Swap the real broker into the Executor; register in `kernel.ts`.**

- [ ] **Step 6: Verify + commit.**
```bash
git commit -m "feat(mk47-hephaestus): Credential Broker — per-invocation derived/wrapped-static/dry-run mints, redaction, mint audit"
```

---

## Task 8 — Adapter Host (`apps/adapter-host`)

**Files:**
- Create: `apps/adapter-host/{package.json,tsconfig.json,src/main.ts,
  src/host.ts,src/worker-runtime.ts,src/ipc.ts,src/container.ts,src/pool.ts}` + tests
- Modify: `apps/core/src/kernel/executor/executor.ts` (real `AdapterRunner`)
- Modify: `apps/core/src/kernel/lifecycle/kernel.ts` or a compose file (the host
  runs as its own process; the Executor talks to it over the typed IPC)

**Interfaces — Produces:**
- `AdapterHost.run(job: { invocationId; capabilityId; version; action; input;
  handle: CredentialHandle; mode; timeoutMs; executionEnvironment }):
  Promise<{ output: unknown; log: LogRecord[] }>` — spawns the worker, pipes
  IPC, enforces `timeoutMs` via `AbortSignal`, tears down
- `worker-runtime.ts` — the entrypoint a generated `worker.entry.ts` imports;
  builds `AdapterContext` (`input`, `mode`, `credential` via broker `redeem`,
  `log` through the redactor, `http` enforcing `declaredEgress`, `abortSignal`);
  **no `process.env` beyond `NODE_ENV`**, cwd is a fresh scratch dir
- `container.ts` — `worker+container` path: fresh restricted container per
  invocation (reuses the LABS Docker helper), default-deny network except
  `declaredEgress`, resource caps, teardown

**Interfaces — Consumes:** Task 2 (`generateWorkerEntry`), Task 7 (`redeem`),
Task 6 interface.

- [ ] **Step 1: Failing test — `host.test.ts`:**
```ts
it('spawns a fresh worker with zero inherited secret env', async () => {
  process.env.SUPER_SECRET = 'leak-me';
  const host = new AdapterHost({ brokerRedeem: fakeRedeem });
  const { output } = await host.run(jobFor('capabilities._echoenv', 'dump', {}));
  expect(JSON.stringify(output)).not.toContain('leak-me');
});
it('MEDIUM+ gets a fresh process per invocation (no pool reuse)', async () => {
  const host = new AdapterHost({ brokerRedeem: fakeRedeem });
  const a = await host.run(jobFor('capabilities.filesystem', 'write_file', { path: '/ws/a', content: '1' }, 'MEDIUM'));
  const b = await host.run(jobFor('capabilities.filesystem', 'write_file', { path: '/ws/b', content: '2' }, 'MEDIUM'));
  expect(a.workerPid).not.toBe(b.workerPid);
});
it('AMBIENT reads may reuse a pooled worker', async () => {
  const host = new AdapterHost({ brokerRedeem: fakeRedeem });
  const a = await host.run(jobFor('capabilities.telemetry', 'read_metrics', {}, 'AMBIENT'));
  const b = await host.run(jobFor('capabilities.telemetry', 'read_metrics', {}, 'AMBIENT'));
  expect(a.workerPid).toBe(b.workerPid);
});
it('the worker cannot open a socket to NATS / the Kernel DB', async () => {
  const host = new AdapterHost({ brokerRedeem: fakeRedeem });
  const { log } = await host.run(jobFor('capabilities._probe', 'try_connect', { targets: ['nats://localhost:4222','postgres://localhost:5432'] }));
  expect(log.find(l => l.msg.includes('connect'))?.fields?.result).toBe('blocked');
});
it('enforces timeoutMs via abort', async () => {
  const host = new AdapterHost({ brokerRedeem: fakeRedeem });
  await expect(host.run(jobFor('capabilities._sleep', 'sleep', { ms: 5000 }, 'LOW', 100))).rejects.toThrow(/timeout|abort/i);
});
```

- [ ] **Step 2: Run — FAIL. Step 3: Implement `host.ts`, `worker-runtime.ts`,
`ipc.ts`, `pool.ts`, `container.ts`, `main.ts`.** Worker spawn: `child_process.
fork` (or a Node `Worker`) with `env: { NODE_ENV }` only, `cwd` a `mkdtemp`
scratch dir removed on exit. Block egress in the worker by installing a
`ctx.http` allowlist and **not** exposing `net`/`dns` helpers; for
`worker+container`, the container's network is `--network none` plus a proxy
sidecar for `declaredEgress` only.

- [ ] **Step 4: Wire the real `AdapterRunner` into the Executor**; the Executor
↔ Host channel is a typed local IPC (`ipc.ts`); run
`apps/core/test/executor-host.integration.test.ts` — a real `filesystem`
`write_file` end-to-end through Executor → Host → worker → verify.

- [ ] **Step 5: Verify + commit.**
```bash
git commit -m "feat(mk47-hephaestus): apps/adapter-host — per-invocation zero-env workers, container path, egress fencing, pool for reads"
```

---

## Task 9 — Adapters: filesystem, web, telemetry (prove the loop)

**Files:** `capabilities/{filesystem,web,telemetry}/{definition.ts,
manifest.json,worker.entry.ts,*.test.ts,*.integration.test.ts}`

**Interfaces — Produces:** three registered `Capability` manifests + adapters
matching spec §8. **Consumes:** Tasks 2, 5, 6, 8.

- [ ] **Step 1: `filesystem` failing tests** (`*.test.ts` with the SDK
`runAction` testkit + a fake credential):
```ts
it('write_file inside the workspace succeeds and verify() confirms the hash', async () => {
  const { output, verify } = await runAction(filesystem, 'write_file',
    { path: 'notes/a.txt', content: 'hello' }, { credential: fakeWsCred('/tmp/ws') });
  const v = await verify();
  expect(v.verified).toBe(true);
});
it('write_file refuses a path that escapes the workspace root', async () => {
  await expect(runAction(filesystem, 'write_file', { path: '../../etc/passwd', content: 'x' },
    { credential: fakeWsCred('/tmp/ws') })).rejects.toThrow(/outside workspace/i);
});
it('write_file refuses a symlink that points outside the root', async () => { /* create symlink in fixture */ });
it('delete_file is riskClass HIGH', () => {
  expect(filesystem.manifest.actions.find(a => a.name === 'delete_file')!.riskClass).toBe('HIGH');
});
it('rollback of write_file restores the prior content (or absence)', async () => {
  const { rollback } = await runAction(filesystem, 'write_file', { path: 'a.txt', content: 'new' },
    { credential: fakeWsCred('/tmp/ws'), before: { existed: false } });
  const rr = await rollback!();
  expect(rr.undone).toBe(true);
});
```

- [ ] **Step 2: Run — FAIL. Step 3: Implement `filesystem/definition.ts`**
(canonicalize with `path.resolve` + `fs.realpath`, assert `startsWith(root)`;
`write_file` captures before-state; `verify` = `hash-match`; `rollback` =
restore-snapshot). Generate `manifest.json` + `worker.entry.ts`.

- [ ] **Step 4: `web` + `telemetry`** — `web` GET-only, `domain-allow`
enforced by `ctx.http`, response body tagged `{ trust: 'untrusted', origin }`,
size cap, `riskClass: LOW`; `telemetry` read-only AMBIENT (metrics, process
list, disk health). Tests: `web.get` to a non-allowlisted domain ⇒ blocked;
`web.get` response carries `untrusted` provenance; `telemetry` never has a
write action.

- [ ] **Step 5: Integration** (`JARVIS_IT=1`): register all three via the
Registry; drive `filesystem.write_file` through the **real** Executor + Host +
Broker; assert `agency.invocations` row reaches `COMPLETED`, a
`jarvis.world.fact.*` is written with `epistemicStatus: observed`, and the
audit trail answers "who/what/policy rule/verify" for the `invocationId`.

- [ ] **Step 6: Verify + commit.**
```bash
git commit -m "feat(mk47-hephaestus): adapters filesystem + web + telemetry, end-to-end through the pipeline"
```

---

## Task 10 — Adapters: github, docker, terminal (HIGH-risk)

**Files:** `capabilities/{github,docker,terminal}/*`

- [ ] **Step 1: `terminal` failing tests:**
```ts
it('run takes an argv array and never a shell string', () => {
  const run = terminal.manifest.actions.find(a => a.name === 'run')!;
  expect((run.inputSchema as any).properties.argv.type).toBe('array');
  expect((run.inputSchema as any).properties).not.toHaveProperty('command');
});
it('run refuses argv[0] not in the grant command-allow list', async () => {
  await expect(runAction(terminal, 'run', { argv: ['curl', 'http://x'] },
    { credential: fakeCmdCred(['git','ls']) })).rejects.toThrow(/not permitted/i);
});
it('run never interpolates — a metacharacter in an arg is passed literally', async () => {
  const { output } = await runAction(terminal, 'run', { argv: ['echo', '$(rm -rf /)'] },
    { credential: fakeCmdCred(['echo']) });
  expect(output.stdout.trim()).toBe('$(rm -rf /)');
});
it('run is riskClass HIGH minimum', () => {
  expect(terminal.manifest.actions.find(a => a.name === 'run')!.riskClass).toBe('HIGH');
});
```

- [ ] **Step 2–3: Implement `terminal`** — `child_process.execFile(argv[0],
argv.slice(1), { shell: false })`, `argv[0]` ∈ grant `command-allow`,
`simulate` returns the exact resolved argv, `verify` runs a declared
post-condition check (e.g. exit 0 + a stdout matcher from input).

- [ ] **Step 4: `github`** — `derived` fine-grained token (Task 7), `repo-allow`
constraint; `create_branch`/`open_pr` MEDIUM, `merge`/`push --force` HIGH;
`merge` to a protected branch ⇒ policy `REQUIRE_APPROVAL` (base pack rule);
`verify` = `world-read` the ref SHA on the remote. Tests with a fake GitHub.

- [ ] **Step 5: `docker`** — a **socket proxy** (`src/socket-proxy.ts` in the
capability dir) with a per-invocation command allowlist from the credential;
`ps`/`inspect` LOW, `run` HIGH (`container-image-allow`), `stop` MEDIUM,
`rm -f`/`prune` CRITICAL (needs `confirmationPhrase`); `verify` = container
state / health probe. Tests: a raw-socket path is unreachable; `run` of a
non-allowlisted image is denied; `prune` requires dual control.

- [ ] **Step 6: Integration** (`JARVIS_IT=1`, Docker-gated): `docker.run` a
throwaway `alpine` echo through the full pipeline; `github` against a local
fake; `terminal.run git --version`.

- [ ] **Step 7: Verify + commit.**
```bash
git commit -m "feat(mk47-hephaestus): adapters github (derived token) + docker (socket proxy) + terminal (argv-only, no shell)"
```

---

## Task 11 — Adapters: windows, browser + six future-domain interface stubs

**Files:** `capabilities/{windows,browser}/*`,
`capabilities/{email,calendar,scalesmiths,smart-home,mobile,robotics}/definition.ts`

- [ ] **Step 1: `windows` failing tests** — `executionEnvironment ===
'node-local:<workstation-nodeId>'`; only a fixed API allowlist (read display /
window / process list = AMBIENT-LOW; `set_registry`, `service_control` = HIGH);
no arbitrary process spawn action exists; `verify` = `state-echo`.

- [ ] **Step 2–3: Implement `windows`** behind a thin OS-API interface
(`src/win-api.ts`) so it unit-tests with a fake and only really runs on the
workstation node.

- [ ] **Step 4: `browser`** — `executionEnvironment: 'worker+container'`,
isolated ephemeral profile, no credential store, fetched content tagged
`untrusted` + provenance, downloads to a quarantine dir; `open`/`navigate`/
`extract_text` LOW, `click`/`fill` MEDIUM, `download` HIGH. Tests with a
headless-browser fake.

- [ ] **Step 5: The six interface stubs** — `defineCapability` with real
actions/schemas/risk, `execute` throwing `new Error('NOT_IMPLEMENTED')`,
registered `active: false`. One test: registering them succeeds, invoking one
via the Executor ends `FAILED` (not a crash) with a typed
`invocation.failed` reason `NOT_IMPLEMENTED`, proving the pipeline gates a
future adapter with no new mechanism.

- [ ] **Step 6: Verify + commit.**
```bash
git commit -m "feat(mk47-hephaestus): adapters windows + browser; email/calendar/scalesmiths/smart-home/mobile/robotics interface stubs"
```

---

## Task 12 — Sentinel

**Files:**
- Create: `apps/core/src/kernel/sentinel/{detector-service.ts,detectors/*.ts,
  thresholds.ts,index.ts}` + tests
- Create: `agents/sentinel/manifest.json`
- Modify: `apps/core/src/kernel/lifecycle/kernel.ts`; `scripts/lint.mjs`
  (intrusion-verb denylist already in Task 2 — assert it here too)

**Interfaces — Produces:**
- `SentinelDetectorService` — subscribes to `SECURITY`/`AUDIT`/`health` events +
  `telemetry` output; runs the 12 detectors (ADR-0028 / spec §11) as pure
  functions over event windows; emits `jarvis.security.alert.<severity>` with a
  structured `finding`
- `detectors/*.ts` each `detect(window: EventWindow, cfg: Thresholds):
  Finding[]` — pure
- `agents/sentinel/manifest.json` — `proposalScope.kinds = ['answer',
  'policy_recommendation']`, `capabilities: []`, `allowedTools:
  ['audit_query','atlas_query']`

- [ ] **Step 1: Failing tests — `detectors/auth-bruteforce.test.ts` etc.**, one
per detector, each driving a synthetic event trace:
```ts
it('auth.bruteforce fires after N failures for one identity in the window', () => {
  const w = windowOf(range(6).map(i => authFailEvent('id-1', tPlus(i * 1000))));
  const f = detectAuthBruteforce(w, { bruteforceN: 5, windowMs: 60_000 });
  expect(f).toHaveLength(1);
  expect(f[0].severity).toBe('high');
});
it('cap.first-critical fires on a principal\'s first CRITICAL invocation', () => { /* ... */ });
it('cred.mint-anomaly fires when a mint has no matching started within T', () => { /* ... */ });
```

- [ ] **Step 2: Run — FAIL. Step 3: Implement `thresholds.ts` (versioned
config), the 12 detectors, `detector-service.ts`.** Register as a
Kernel-internal read-only service in `kernel.ts` (no store writes;
`health.register({ subsystem: 'sentinel', critical: false })`).

- [ ] **Step 4: Failing test — `sentinel.severity.test.ts`:** only
`high`/`critical` (with `corroboration >= 1`) produce a finding eligible to
feed the mode transition; `low`/`elevated` are recorded, mode unchanged.

- [ ] **Step 5: Add `agents/sentinel/manifest.json`** + a test asserting its
`proposalScope.capabilities` is empty and `allowedTools` are read-only.

- [ ] **Step 6: Verify + commit.**
```bash
git commit -m "feat(mk47-hephaestus): Sentinel — 12 deterministic detectors, alert severities, proposing-only specialist manifest"
```

---

## Task 13 — Guardian Response Playbook + restrict-only capabilities

**Files:**
- Create: `capabilities/permission/definition.ts` (`tighten_all`),
  `capabilities/agency-control/definition.ts`
  (`suspend_autonomous_external`, `resume`),
  `capabilities/audit/definition.ts` (`snapshot`),
  `capabilities/node/definition.ts` (`isolate`),
  `capabilities/notify/definition.ts` (`operator`)
- Create: `apps/core/src/kernel/mode/guardian-playbook.ts` + test
- Modify: `apps/core/src/kernel/mode/mode-manager.ts` (run the playbook on the
  `-> GUARDIAN` transition), `transition-policy.ts` (accept a
  `security.alert.high|critical` trigger), `packages/permissions` base pack
  (`base.guardian.lockdown` already present — assert)

**Interfaces — Produces:**
- `runGuardianPlaybook(ctx, finding?): Promise<GuardianOutcome>` — invokes G1–G6
  (spec §12) **through the Executor** in order; each is a normal capability
  invocation; emits `jarvis.security.guardian.step_completed` per step
- the five restrict-only capabilities, each with a real `verify` and
  `reversible: false` (they preserve/restrict; "undo" is the operator
  re-issuing grants)

- [ ] **Step 1: Failing test — `guardian-playbook.test.ts`:**
```ts
it('entering GUARDIAN runs G1..G6 through the Executor and emits step_completed for each', async () => {
  const { modeManager, executor, events } = harness();
  await modeManager.transition('GUARDIAN', { trigger: 'security.alert.critical', finding });
  expect(executor.invokedCapabilities).toEqual([
    'capabilities.permission','capabilities.agency-control','capabilities.audit','capabilities.node','capabilities.notify',
  ]);
  expect(events.byType('jarvis.security.guardian.step_completed')).toHaveLength(5); // G3 is a policy rule, not a step
});
it('the playbook never mints authority or widens a grant', async () => {
  const { modeManager, permission } = harness();
  await modeManager.transition('GUARDIAN', { trigger: 'security.alert.high', finding });
  expect(permission.grantWidenCalls).toBe(0);
  expect(permission.mintCalls).toBe(0);          // playbook steps that need auth go through the Executor like anything else
});
it('node.isolate is skipped when the finding names no node', async () => {
  const { modeManager, executor } = harness();
  await modeManager.transition('GUARDIAN', { trigger: 'security.alert.high', finding: { ...finding, nodeId: undefined } });
  expect(executor.invokedCapabilities).not.toContain('capabilities.node');
});
it('leaving GUARDIAN requires an explicit operator security.cleared command', async () => {
  const { modeManager } = harness({ mode: 'GUARDIAN' });
  await expect(modeManager.transition('AMBIENT', { trigger: 'health.recovered' })).rejects.toThrow(/security.cleared/i);
  await modeManager.transition('AMBIENT', { trigger: 'security.cleared', by: 'operator' });
});
```

- [ ] **Step 2: Run — FAIL. Step 3: Implement the five capabilities + the
playbook + the mode-manager wiring.** `permission.tighten_all` iterates active
grants setting `maxRiskWithoutLiveApproval = 'LOW'`, `mayProceedWithoutLiveApproval
= false`, bumping `version`; `audit.snapshot` freezes partitions + dumps
in-flight `agency.invocations` (adds retention only); `node.isolate` revokes a
node cert + drops subscriptions.

- [ ] **Step 4: Verify + commit.**
```bash
git commit -m "feat(mk47-hephaestus): Guardian Response Playbook — six restrict-only steps through the Executor, operator-reversible"
```

---

## Task 14 — FORGE + JARVIS LABS

**Files:**
- Create: `apps/labs/{package.json,tsconfig.json,src/main.ts,src/sandbox.ts,
  src/run-draft.ts,src/analysis.ts,src/reaper.ts}` + tests
- Create: `agents/forge/manifest.json` (draft behaviour)
- Create: `apps/core/src/kernel/capability-registry/promotion.ts` + test
  (the 7-step pipeline orchestration, operator-gated)
- Modify: `packages/contracts/src/proposal.ts` (already `capability_draft` in
  Task 1), `event-names.ts` (`capability_gap`, `labs.run_*`, `probation.*` in
  Task 1)

**Interfaces — Produces:**
- `LabsSandbox.run(draft: CapabilityDraftProposal): Promise<LabsRunReport>` —
  ephemeral Docker (reuse `apps/adapter-host/src/container.ts` helper),
  synthetic creds, mock target API, throwaway PG + scratch FS, `--network none`
  + docs-proxy only, resource caps, full logging, **guaranteed teardown**
  (`reaper.ts` kills orphans)
- `analysis.ts` `analyseDraft(dir): StaticAnalysis` — `tsc` strict +
  `lintCapabilities` + `validateManifest` + dependency-advisory audit +
  declared-egress vs static-scan diff; any HIGH/CRITICAL advisory or undeclared
  egress ⇒ `verdict: 'failed'`
- `promotion.ts` `promote(draftId, operatorApproval: SignedCommand): Promise<{
  ok: true; capabilityId } | { ok: false; reason }>` — requires
  `authTrustLevel: 'verified'`; on success registers via the Registry at
  `max(declared, HIGH)` + `approvalPolicy: 'always'` (probation)

- [ ] **Step 1: Failing test — `labs.isolation.integration.test.ts`
(`JARVIS_IT=1`, Docker-gated):**
```ts
it('a draft adapter that tries to reach the real DB / NATS / internet inside LABS is blocked and recorded', async () => {
  const report = await labs.run(draftThatProbes(['postgres://kernel:5432','nats://kernel:4222','https://evil.example']));
  expect(report.verdict).toBe('failed');
  expect(report.tests.report).toMatch(/blocked|unreachable/i);
});
it('LABS tears down its container + volumes even if the draft hangs', async () => {
  await labs.run(draftThatHangs(), { wallTimeMs: 2000 });
  expect(await dockerPs()).not.toContain('jarvis-labs-');
});
it('analyseDraft fails a draft that reads process.env for a secret', async () => {
  const a = await analyseDraft(fixtureDir('reads-env'));
  expect(a.verdict).toBe('failed'); expect(a.findings.join()).toMatch(/process\.env/);
});
```

- [ ] **Step 2: Run — FAIL. Step 3: Implement `sandbox.ts`, `run-draft.ts`,
`analysis.ts`, `reaper.ts`, `main.ts`.**

- [ ] **Step 4: Failing test — `promotion.test.ts`:** `promote` without a
`verified`-trust approval ⇒ `{ ok: false }`; with it ⇒ registers, and the new
capability's first `lookup` reports probation (`riskClass: HIGH`,
`approvalPolicy: 'always'`); there is **no** `capabilities.register` capability
in the registry (assert `lookup('capabilities.register')` is undefined and no
manifest declares a `register` action).

- [ ] **Step 5: `agents/forge/manifest.json`** — `proposalScope.kinds`
includes `capability_draft`; `capabilities: []`; `allowedTools: ['web_get']`
(GET-only research). Test: forge cannot propose a `capability_invocation` for
`capabilities.*` register/promote.

- [ ] **Step 6: Verify + commit.**
```bash
git commit -m "feat(mk47-hephaestus): FORGE draft behaviour + JARVIS LABS sandbox + operator-gated promotion with probation"
```

---

## Task 15 — Security test suite + boundary sweep

**Files:**
- Create: `apps/core/test/security/*.security.test.ts` (one file per threat
  cluster) + `apps/core/test/security/boundary-sweep.test.ts`

**Interfaces — Consumes:** everything above.

- [ ] **Step 1: Write the 28-threat suite.** One `it()` per threat T1–T28
(spec §15.1) asserting the **structural** block. Examples:
```ts
// T20 confused deputy
it('T20: an agent cannot get the Executor to act with a scope the requesting principal lacks', async () => {
  const r = await executor.invoke(
    proposalFor('capabilities.github','merge',{ repo:'octo/prod', base:'main' }),
    agentActorFor('p-limited'));                       // p-limited holds no github.merge scope
  expect(r.outcome).toBe('denied');
});
// T27 fake verification
it('T27: an adapter that reports success without effect ends VERIFICATION_FAILED', async () => {
  registerFakeAdapter('capabilities._liar', { execute: () => ({ ok: true }), verify: () => ({ verified: false, checks: [] }) });
  const r = await executor.invoke(proposalFor('capabilities._liar','do',{}), operatorActor);
  expect(['verification_failed','rolled_back']).toContain(r.outcome);
});
// T28 double execution
it('T28: two proposals with the same idempotencyKey execute the effect once', async () => {
  const p = proposalFor('capabilities.filesystem','write_file',{ path:'/ws/x', content:'1' });
  const [a, b] = await Promise.all([executor.invoke(p, operatorActor), executor.invoke(p, operatorActor)]);
  expect([a.outcome, b.outcome].filter(o => o === 'verified')).toHaveLength(1);
});
// T6 fail-closed
it('T6: REQUIRE_APPROVAL with the operator unreachable does not execute', async () => {
  const r = await executor.invoke(proposalFor('capabilities.terminal','run',{ argv:['git','status'] }),
    agentActor, { context: { operatorReachable: false } });
  expect(r.outcome).toBe('denied');
});
```

- [ ] **Step 2: Write the brief's 17 scenarios** (spec §15.2) — map each to an
`it()` (several overlap with T-numbers; keep both for traceability, cross-ref
in the test name).

- [ ] **Step 3: Engine-level tests** (spec §15.3): policy determinism (re-run
of Task 3's property test at the integration layer), "no model verdict"
corpus assertion over **seeded DB rules** (not just the base pack), the
fail-closed matrix, lifecycle-legality (assert only
`LEGAL_INVOCATION_TRANSITIONS` edges appear across a fuzzed run), dual-control
negatives, SDK-lint fixtures, LABS isolation.

- [ ] **Step 4: `boundary-sweep.test.ts`** (spec §15.4): walk every
`capabilities/*/manifest.json` and `agents/*/manifest.json`; assert (a) no
adapter module is importable outside `apps/adapter-host` (grep the built graph
/ a lint pass), (b) no component holds both an adapter credential and
model/agent output (static check over `apps/core` imports: nothing imports both
`@jarvis/gateway`/`agents` and `credential-broker`), (c) every path from a
`Proposal` to an effect goes Validator→Policy→Permission→freshness→(sim)→exec→
verify — encoded as an assertion that `Executor.invoke` is the only exported
symbol that emits `jarvis.agency.invocation.started`.

- [ ] **Step 5: Verify + commit.** Full `vitest run` green; `JARVIS_IT=1
vitest run` green where Docker is up.
```bash
git commit -m "test(mk47-hephaestus): security suite — 28 threats + 17 scenarios + engine tests + boundary sweep"
```

---

## Task 16 — Docs reconciliation + implementation notes

**Files:**
- Modify: `AGENCY_MODEL.md`, `SECURITY_MODEL.md`, `SENTINEL_MODEL.md`,
  `docs/security/threat-model.md`, `KERNEL_CONSTITUTION.md`, `ROADMAP.md`,
  `GLOSSARY.md`, `apps/README.md`, `packages/README.md`, `SYSTEM_BOUNDARIES.md`
  — flip "as-designed" language to "as-built" where it now matches; correct any
  drift found during implementation
- Create: `docs/architecture/MK47_HEPHAESTUS_IMPLEMENTATION_NOTES.md` — real vs
  interface-only (the 6 future-domain stubs; `derived` github token real or
  wrapped-static fallback; container isolation actually exercised or seam);
  toolchain deviations taken; the verified-green gate (`tsc` 0, `lint` clean,
  `vitest` N passing, `JARVIS_IT=1` M passing / skipped) + any bench
- Modify: `docs/architecture/adr/0025..0030` — only if implementation forced a
  design change; each such change is an **ADR amendment**, never a silent edit

- [ ] **Step 1:** Run the full gate; record exact numbers.
- [ ] **Step 2:** Write `MK47_HEPHAESTUS_IMPLEMENTATION_NOTES.md` (pattern:
`MK43_IMPLEMENTATION_NOTES.md` / `MK47A_IMPLEMENTATION_NOTES.md`).
- [ ] **Step 3:** Reconcile the model docs; add the notes doc to
`docs/architecture/README.md` index.
- [ ] **Step 4:** Print the spec §15 success-criteria checklist ticked + the
threat-coverage table.
- [ ] **Step 5: Commit.**
```bash
git commit -m "docs(mk47-hephaestus): reconcile agency/security docs to as-built; verification green"
```

---

## Self-Review

**Spec coverage** — every spec §1.1 item maps to a task: authority core →
T3–T8; SDK → T2; 8 adapters → T9–T11; future interfaces → T11; Sentinel → T12;
Guardian → T13; FORGE + LABS → T14; security suite → T15; docs → T16. Spec §3
contract deltas → T1. Spec §4 events → T1. Spec §5 schema → T1. Spec §6
pipeline → T6. Spec §15 tests → T15 (+ per-task tests throughout).

**Placeholder scan** — no "TBD"/"handle edge cases"/"similar to Task N". Each
code step has real test code or a named implementation with the tricky part
spelled out. DDL / full event catalog / full contract field lists live in the
spec (travels with the plan) rather than being restated.

**Type consistency** — `InvocationState` / `LEGAL_INVOCATION_TRANSITIONS`
(T1) used in T6, T15. `evaluatePolicy` / `PolicyDecision` (T3) used in T4, T6.
`CredentialHandle` / `mint` (T1 type, T7 impl) used in T6, T8. `Capability` /
`validateManifest` (T1/T5) used in T5, T14. `runGuardianPlaybook` (T13) wired
in T13 only. `LabsRunReport` (T1) produced in T14.

**Build-order independence** — T6 is written against `FakeBroker` /
`FakeAdapterRunner` interfaces it defines, so it is testable before T7/T8 land
the real implementations behind the same interface. Every other task depends
only on earlier tasks.

**Risk** — Docker availability gates the integration slices of T9–T11 and all
of T14; those tests self-skip when Docker is down (MK.43 pattern), and the
unit layer of every task stands alone. The `0007` vs `0008` migration-number
coordination is called out in Global Constraints.
