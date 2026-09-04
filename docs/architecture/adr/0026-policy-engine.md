# ADR-0026: The deterministic Policy Engine — rule AST, evaluation order, base rule pack

Status: Accepted
Date: 2026-09-03
Deciders: Principal Security Architect (Claude), Principal (rhyslacy123)

## Context

L20: policy enforcement is deterministic. L21: an LLM may recommend but never
override policy. `SECURITY_MODEL.md` §3 fixes the risk→authority tier table.
The `policy.ts` contract declares `PolicyRule.predicate: unknown` and leaves
the concrete DSL to `packages/permissions`. HEPHAESTUS must nail down: the
predicate language, the evaluation order, conflict resolution, the default
verdict, how untrusted-derived proposals are capped, and what the engine ships
with on day one.

## Decision

### Pure function, typed inputs only

`evaluate(PolicyQuery) → PolicyDecision`. No network, no model call, no
filesystem, no wall-clock read except explicit `timeWindow` rule operators
evaluated against `context.now` (which is supplied, not read). Same inputs ⇒
same decision, forever. A property-test suite asserts determinism across the
whole rule corpus and random `PolicyQuery` inputs.

### Rule predicate = a serialized AST, not code

A `PolicyRule.predicate` is a JSON AST over a fixed operator set:

```
Node =
  | { op: 'and' | 'or', args: Node[] }
  | { op: 'not', arg: Node }
  | { op: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte', path: string, value: Json }
  | { op: 'in' | 'not-in', path: string, values: Json[] }
  | { op: 'matches', path: string, pattern: string }        -- RE2, no backrefs
  | { op: 'path-under', path: string, prefix: string }      -- filesystem-safe prefix test
  | { op: 'time-window', tz: string, windows: [{ dow, from, to }] }  -- vs context.now
  | { op: 'scope-held', scope: string }                     -- actor.heldScopes contains
  | { op: 'risk-at-least', class: RiskClass }
```

`path` addresses fields of `PolicyQuery` only (`actor.*`, `action.*`,
`context.*`). There is no `eval`, no user-supplied function, no model call
node. The evaluator is ~200 lines and total.

### Evaluation order and conflict resolution

1. **Hard caps first** (not rules — engine invariants):
   - `context.derivedFromUntrusted === true` ⇒ any `action.riskClass` above
     `LOW` ⇒ **DENY** (ADR-0018 §4.3). Not overridable by any rule.
   - `action.requiredScopes ⊄ actor.heldScopes` ⇒ **DENY** (missing scope is
     never "ask", it is "no").
   - `context.jarvisMode === 'GUARDIAN'` ⇒ `action.riskClass === 'CRITICAL'` ⇒
     **DENY**; other risk classes fall through to rules (which may further
     restrict).
2. **Rules**, highest `priority` first. First matching rule whose `effect` is
   `DENY` wins immediately. Otherwise the highest-priority matching rule's
   effect is taken. **At equal priority, `DENY` beats `REQUIRE_APPROVAL` beats
   `ALLOW`.**
3. **Default verdict** when no rule matches:
   - `AMBIENT` ⇒ `ALLOW`
   - `LOW` ⇒ `REQUIRE_APPROVAL`
   - `MEDIUM` / `HIGH` / `CRITICAL` ⇒ `DENY`
   (Fail-closed: an unconfigured system permits only ambient reads.)

`PolicyDecision` records `firedRuleIds` and a deterministic `rationale`
string, both audited.

### The LLM recommendation is one input, weakly

`context.llmRecommendation` may be referenced **only** by rules of the form
`{ op: 'eq', path: 'context.llmRecommendation', value: 'DENY' } ⇒ effect: DENY`.
Manifest/rule validation **rejects** any rule that references
`context.llmRecommendation` with an effect other than `DENY`. A model can make
policy stricter, never looser.

### Mode and objective authority are restrict-only

Rules may branch on `context.jarvisMode` and `context.activeObjectiveGate`
only to reach a **more** restrictive effect than the default. Rule validation
rejects a rule that would produce `ALLOW` gated on `jarvisMode` when the
mode-free evaluation of the same query is `REQUIRE_APPROVAL`/`DENY`. (Checked
by a static analysis over the rule + a differential property test.)

### Base rule pack (ships enabled)

Seeded rows, versioned, editable only by the Policy Engine admin path:

| id | Effect | Gist |
|---|---|---|
| `base.read.ambient` | ALLOW | `risk == AMBIENT` |
| `base.github.read` | ALLOW | `capability == github && action in {list_*, get_*, read_*}` |
| `base.github.branch.create` | ALLOW | `action == create_branch && scope-held github.branch.write` |
| `base.github.merge.protected` | REQUIRE_APPROVAL | `action == merge && target protected` |
| `base.github.force_push` | REQUIRE_APPROVAL | `action == push && force == true` |
| `base.fs.write.workspace` | ALLOW | `action == write_file && path-under workspaceRoot && scope-held filesystem.write` |
| `base.fs.write.outside` | DENY | `action == write_file && not path-under workspaceRoot` |
| `base.terminal.any` | REQUIRE_APPROVAL | `capability == terminal` (unless a preauthorized command-allowlist scope matches) |
| `base.deploy.staging` | ALLOW | `action == deploy && env == staging && scope-held deploy.staging && context.degradation == nominal` |
| `base.deploy.production` | REQUIRE_APPROVAL | `action == deploy && env == production` |
| `base.db.drop.production` | DENY | `action in {drop_*, truncate_*, delete_database} && env == production` (needs an explicit CRITICAL grant + dual control to reach ALLOW) |
| `base.comms.external.send` | REQUIRE_APPROVAL | `sideEffects includes external-message && not scope-held comms.preauthorized` |
| `base.spend.any` | REQUIRE_APPROVAL | `sideEffects includes spend` |
| `base.spend.financial_transfer` | DENY | `action == financial_transfer` unless `scope-held finance.transfer && authTrustLevel == verified` (then dual control) |
| `base.untrusted.cap` | DENY | `context.derivedFromUntrusted && risk-at-least MEDIUM` (redundant with the hard cap; present so audit shows an explicit rule) |
| `base.guardian.lockdown` | DENY | `context.jarvisMode == GUARDIAN && risk-at-least HIGH` |

## Alternatives considered

- **A real expression language (CEL, JSONLogic, a mini-Lisp).** More
  expressive, but a larger evaluator to audit and a surface for
  non-termination / injection. The fixed operator set covers every base-pack
  rule and is trivially total. Rejected.
- **Rules as TypeScript functions loaded at boot.** Fast and expressive, but
  it is code in the protected process, un-diffable by a reviewer as data, and
  a supply-chain target. Rejected — rules are data (L20 enforcement note,
  KERNEL_CONSTITUTION §3).
- **Default `ALLOW` for LOW when unconfigured (less friction on a fresh
  install).** Fails closed is the safer default and the constitution's stance
  (`SECURITY_MODEL.md` §3). Rejected.
- **Let a rule return `context.llmRecommendation` verbatim.** Directly
  violates L21. Rejected; validation forbids it.

## Benefits

- The engine is small, total, and property-testable; determinism is
  structural, not a convention.
- A reviewer reads rules as data and can diff a policy change.
- "No model verdict" is enforced by rule-validation, not documentation.
- Fail-closed default means a misconfiguration cannot open authority.

## Disadvantages

- The fixed operator set will occasionally need a new operator (an ADR
  amendment + evaluator change); expressiveness is deliberately bounded.
- The base pack encodes opinions that a deployment may need to retune.

## Risks

- **A subtly permissive rule ships in the base pack.** Mitigated: the pack is
  covered by explicit ALLOW/DENY unit tests per row plus adversarial
  `PolicyQuery` fuzzing; every base rule is listed in this ADR for review.
- **`matches` regex denial-of-service.** Mitigated: RE2 (linear-time, no
  backreferences); pattern length capped at registration.

## Consequences

- `packages/permissions` implements the evaluator, the AST types, the
  validator, and the base-pack seed.
- `policy.ts` contract: `predicate` typed to the AST union above;
  `PolicyContext` extended (`resourceRef`, `originNodeId`, `location`,
  `authTrustLevel`, `authMethod`, `jarvisMode`, `sessionId`,
  `activeObjectiveGate`, `recentDenialCount`).
- `SECURITY_MODEL.md` §3 gains the evaluation-order and default-verdict text.

## Reversal difficulty

**Moderate.** Swapping the predicate language means rewriting the evaluator and
migrating stored rules, but the `evaluate()` signature and the decision
semantics are stable; consumers do not change.
