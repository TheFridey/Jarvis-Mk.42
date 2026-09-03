# ADR-0030: The Capability SDK — `defineCapability`, manifest codegen, security lint

Status: Accepted
Date: 2026-09-03
Deciders: Principal Security Architect (Claude), Principal (rhyslacy123)

## Context

ADR-0016 says a capability is "a manifest + an out-of-process adapter". Nothing
yet defines *how an author writes one*. The brief: "Capabilities should be easy
to create correctly and difficult to create insecurely." Without an SDK, each
adapter re-implements input parsing, the Executor IPC handshake, the credential
handle, logging, and the verify/rollback contract by hand — and each is a place
to get isolation wrong.

## Decision

### `@jarvis/capability-sdk` — one way to declare a capability

```ts
export default defineCapability({
  id: 'capabilities.github',
  version: '1.0.0',
  description: '...',
  provider: 'github',
  executionEnvironment: 'worker',            // | 'worker+container' | 'node-local:<nodeId>'
  auditPolicy: { hashInput: true, recordOutput: 'summary' },
  privacyRequirements: { maxContentPrivacyClass: 'SENSITIVE' },

  actions: {
    create_branch: {
      input:  z.object({ repo: z.string(), name: z.string(), fromSha: z.string() }),
      output: z.object({ ref: z.string(), sha: z.string() }),
      risk: 'MEDIUM',
      reversible: true,
      idempotent: true,
      requiredScopes: ['github.branch.write'],
      approvalPolicy: 'default',
      timeoutMs: 15_000,

      async execute(ctx, input) { /* uses ctx.credential, ctx.log — NOT process.env */ },
      async verify(ctx, input, output) { /* re-reads the ref from the API; returns VerificationReport */ },
      async rollback(ctx, input, before) { /* deletes the ref; has its own effect + is itself verified */ },
      async simulate(ctx, input) { /* dry-run cred; returns PredictedEffect */ },
    },
  },
});
```

- **Zod schemas → JSON Schema** at build time; the manifest's `inputSchema` /
  `outputSchema` are generated, never hand-written.
- **Codegen** emits `capabilities/<id>/manifest.json` (the data the Registry
  stores) and `capabilities/<id>/worker.entry.ts` (the IPC entrypoint the
  Adapter Host spawns). Authors touch neither.
- `ctx` (`AdapterContext`) exposes exactly: `credential` (a scoped handle),
  `log` (structured, redaction-filtered), `input`, `mode` (`dry-run`|`full`),
  `abortSignal`. No bus, no DB, no `process.env`, no `fetch` to arbitrary
  hosts (a `ctx.http` wrapper enforces the capability's declared egress).

### Security lint (extends `scripts/lint.mjs`, also runnable standalone)

Applied to every file under `capabilities/**`:

| Rule | Rationale |
|---|---|
| no `import ... from '@jarvis/(gateway\|agents\|world-model\|memory\|persistence\|atlas\|mnemosyne)'` | an adapter is not cognition and holds no store credential |
| no `process.env` read (except `NODE_ENV`) | secrets come from `ctx.credential` only (ADR-0025) |
| no `child_process`, `node:vm`, `worker_threads` unless `provider === 'terminal'` | no arbitrary code execution outside the one domain that declares it |
| no bare `fetch(` / `http(s).request(` — must be `ctx.http(...)` | egress is declared and enforced |
| every `actions.<name>` object exports `verify` | L22, no "assumed success" |
| every `reversible: true` action with a non-empty `sideEffects` exports `rollback` | L23 |
| every `risk: 'CRITICAL'` action declares `confirmationPhrase` | ADR-0027 dual control |
| `sideEffects` contains no active-intrusion verb (`exploit`, `bruteforce`, `port-scan`, `payload`, `c2`, `keylog`, `exfiltrate`) | ADR-0028 — no offensive capability |
| manifest `id` matches `^capabilities\.[a-z][a-z0-9_]*$`; `version` is semver | Registry key hygiene |

Lint failure blocks registration (manual authoring) and blocks LABS promotion
step 4 (FORGE authoring).

### Testkit

`@jarvis/capability-sdk/testkit` provides `runAction(cap, action, input, {
credential: fake, mode })` and assertion helpers so an author's unit tests
exercise `execute → verify → rollback` against a fake credential without the
full Kernel — and the same harness drives the security test suite's
adapter-level cases.

## Alternatives considered

- **Plain interface + "please follow the rules".** The rules are then
  documentation, not enforcement — the exact anti-pattern L30 rejects.
  Rejected.
- **A decorator-based API (`@capability`, `@action`).** Needs
  `reflect-metadata` and TS decorator config, which the MK.43 toolchain
  deviations already back away from. Rejected — a plain object literal +
  codegen is simpler and lints better.
- **Hand-written manifests, SDK only for the runtime.** Two sources of truth
  (schema in the manifest vs schema in code) drift. Rejected — the manifest is
  generated from the definition.
- **Let adapters use `fetch` freely.** Then egress is undeclared and
  unauditable. Rejected — `ctx.http` + a declared target list.

## Benefits

- One correct shape; the insecure moves (`process.env`, `child_process`, bare
  `fetch`, missing `verify`) do not lint.
- Manifest and runtime cannot drift — both are generated from one definition.
- The same testkit serves authors and the security test suite.
- Codex (and FORGE) have an unambiguous template to fill.

## Disadvantages

- A build step (codegen) sits between the definition and a runnable adapter.
- Zod is a runtime dependency for every adapter worker (small, already used by
  `@jarvis/validation`).

## Consequences

- New package `@jarvis/capability-sdk` (`packages/capability-sdk/`), plus the
  `capabilities/` top-level directory for definitions + generated artifacts.
- `scripts/lint.mjs` gains the `capabilities/**` rule set.
- `AGENCY_MODEL.md` §9 (Adapters) references the SDK as the authoring path.

## Reversal difficulty

**Low.** The SDK is an authoring convenience over the ADR-0016/0025 contracts.
Adapters could be hand-written against the same manifest + IPC contract; the
SDK just makes the correct version the easy one.
