# ADR-0038: Architecture-fitness and contract-compatibility are enforced by real automated gates, not a single grep

Status: Accepted
Date: 2026-09-03
Deciders: External Principal Architect (ASCENSION Stage A audit), Principal (rhyslacy123)
Relates-to: ROADMAP invariant (versioned contracts), EVENT_ARCHITECTURE §9, KERNEL_CONSTITUTION §2; L40

## Context

`AUDIT_MK42_ASCENSION.md` F-TEST-1..4, F-AG-13:

- The only automated architecture-fitness check is `boundary-sweep.test.ts`
  asserting the string `capabilities/` does not appear in `executor.ts`.
- The security suite tests pure helpers, not the Executor pipeline.
- There is no contract golden/version test anywhere; `EVENT_ARCHITECTURE.md` §9
  governance ("add optional field ⇒ version bump; remove/retype ⇒ new type") is
  unenforced.
- The capability "security lint" is regex over source text presented as a
  structural control.

The ASCENSION prompt names nine fitness rules explicitly and asks for contract
tests with compatibility/versioning coverage. L40 ("MK.43–100 evolve without
destroying foundations") has no automated defense.

## Decision

### 1. `pnpm fitness` — architecture fitness gate (CI-blocking)

A test suite (`test/fitness/*.fitness.test.ts`) using the TypeScript compiler
API for import-graph analysis (not text grep). Minimum rules, each a named
test:

1. **Kernel imports no provider SDK.** No file under `apps/core/src` imports
   `openai`, `@anthropic-ai/*`, `@google/*`, or any module matching a provider
   denylist; inference only via `@jarvis/contracts` `ModelRequest`.
2. **Kernel imports no capability adapter.** No `apps/core/src` import resolves
   under `capabilities/` or an adapter package.
3. **Perception imports no cognition.** `apps/voice`, `apps/vision` (and any
   `perception` package) do not import `@jarvis/gateway`, `@jarvis/agents`, or
   a cognition package.
4. **Agents access no domain repository directly.** Nothing under `agents/`
   imports `@jarvis/persistence`, `atlas`, `mnemosyne`, or a `*-store`.
5. **UI is not authoritative.** `apps/desktop` imports no `@jarvis/persistence`
   and no `*-store`; its only Kernel coupling is an SDK/contracts import and
   `Command`/`Proposal` submission.
6. **Capabilities cannot bypass policy.** Every reachable path to
   `AdapterRunner.execute` in `apps/core` originates in `CapabilityExecutor`,
   and `CapabilityExecutor.invoke` calls the policy evaluator before any
   `broker.mint` / adapter call (AST reachability check).
7. **Critical actions cannot self-complete.** No transition to `COMPLETED`
   exists except from `VERIFYING` after an Executor-run `VerificationRunner`
   result (not `adapter.verify`); grep+AST assert `adapter.verify`'s return is
   never the `COMPLETED` condition.
8. **World Model does not write Kernel authority.** Nothing under
   `atlas`/knowledge-ingestion writes `projections.*`; the `atlas_rw` DB role
   grant excludes `projections`.
9. **Memory is not World Model truth.** `mnemosyne` code does not write
   `atlas.*`; `MemoryRecall` does not import `AtlasQuery`.
10. **Raw frames do not reach cloud by default.** No `apps/vision` code path
    calls `ctx.http` / a gateway with an image/frame payload outside a
    manifest-declared HIGH-risk `*.cloud-analyze` capability.
11. **Observability coverage** (ADR-0036 §2): every `CapabilityExecutor`
    lifecycle-transition method is wrapped in `withSpan`; no span attribute is
    set from `input`, a secret, or prompt/response content.
12. **Threat-model honesty** (ADR-0031 §2): every `docs/security/threat-model.md`
    row marked `Enforcement: enforced` has at least one test referencing the
    named pipeline object.

Rules that cannot yet pass because the subsystem is unbuilt are written as
`test.todo` with the rule text, so the list is complete and visible.

### 2. `pnpm test:contract` — contract-compatibility gate (CI-blocking)

For each frozen contract shape — event envelope, `Provenance`, `Capability` /
`CapabilityAction`, `NodeDescriptor`, `ModelRequest` / `ModelResponse`, `Fact`,
policy rule AST, `Grant` / `AuthorityToken` / `ApprovalRequest`, invocation
lifecycle, `ContextFrame`, `AtlasQuery` / `MemoryRecall` results:

- **Golden fixtures.** A committed JSON fixture at each `schemaVersion`; a test
  asserts the current validator accepts every historical fixture (backward
  compatibility) and that a fixture at version N is missing no field the type
  at version N declares required.
- **Additive-only check.** A structural diff test: between two committed
  snapshots of a contract, a removed field or a narrowed type ⇒ fail with
  "requires a new `type` or major `schemaVersion` + translation consumer"
  (`EVENT_ARCHITECTURE.md` §9). Adding an optional field ⇒ pass with a
  `schemaVersion` bump reminder.
- **Round-trip.** Every contract with a runtime validator: `parse(serialize(x))
  === x` for a representative sample, using **canonical** serialization
  (sorted keys — also fixes F-DATA-4's `JSON.stringify` hashing).
- **Enum freeze.** `retentionClass`, `privacyClass`, `RiskClass`,
  `EpistemicStatus`, `InvocationState`, node `trustTier` — a test lists the
  exact members; changing one requires editing the test with an ADR reference
  in the commit.

### 3. The capability security lint gets an AST backing

`packages/capability-sdk/lint` keeps the fast regex pass for developer feedback
but adds a compiler-API pass used by CI and by JARVIS LABS `analyseDraft`:
resolves `process.env` access (including bracket and aliased), `fetch` /
`child_process` / `vm` / dynamic `import()` of those, and asserts every
manifest `action` has a `verify` **and** a `verificationStrategy` and (if
`reversible` + side effects) a `rollback`. `SECURITY_MODEL.md` /
`threat-model.md` stop calling the regex pass "structural"; the AST pass is the
structural one.

### 4. CI wiring

A committed CI config runs, on every PR: `pnpm typecheck`, `pnpm lint`,
`pnpm test`, `pnpm fitness`, `pnpm test:contract`, `pnpm test:integration`
(with a Postgres service), and — on a schedule — `pnpm test:chaos` and
`scripts/restore-drill.mjs` (ADR-0037). A red fitness or contract test blocks
merge.

## Alternatives considered

- **Keep grep-based checks, add more greps.** Rejected — greps miss aliasing,
  re-exports, and dynamic imports, and produce false confidence (the current
  `boundary-sweep` "passes" while adapters run in-process).
- **Use `dependency-cruiser` / `eslint-plugin-boundaries`.** Reasonable; not
  chosen as the requirement because ESLint is currently un-installable per the
  MK.43 notes and the TS compiler API is already a dependency. Either is
  acceptable if the toolchain allows — the *rules* are the contract, not the
  tool.
- **Contract snapshots via a schema registry service.** Overkill for MK.42;
  committed golden fixtures are enough and are diff-reviewable.

## Benefits

- Architectural decay (the "AI-generated monolith" the phase exists to
  prevent) fails CI instead of accreting.
- A contract change that would break a future MK is caught at the PR.
- The threat model cannot claim an unenforced mitigation without a fitness
  failure.

## Disadvantages

- Writing the compiler-API rules is real work; some are approximate (reachability
  analysis over dynamic dispatch).
- Golden fixtures must be maintained on every legitimate contract change (that
  is the point).

## Risks

- **A rule is too strict and blocks legitimate work, so it gets disabled.**
  Mitigated: each rule cites the law/ADR it enforces; disabling one requires an
  ADR, same as changing a contract.
- **`test.todo` rules are forgotten.** Mitigated: a meta-test asserts the count
  of `test.todo` fitness rules only ever decreases across ASCENSION.

## Consequences

- New `test/fitness/`, `test/contract/`, golden-fixture directory.
- `package.json`: `fitness`, `test:contract` scripts; `verify` includes them.
- New CI config file.
- `packages/capability-sdk/lint`: AST pass added.
- `SECURITY_MODEL.md`, `threat-model.md`: "enforced by `scripts/lint.mjs`"
  reworded to name the AST pass.

## Reversal difficulty

**Low** mechanically (delete the suites). **High** in intent — these gates are
the enforcement of L40; removing them is removing the defense against the exact
failure mode ASCENSION exists to prevent.
