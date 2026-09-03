# ADR-0029: Self-extension — FORGE authors capabilities, JARVIS LABS isolates them, humans promote them

Status: Accepted
Date: 2026-09-03
Deciders: Principal Security Architect (Claude), Principal (rhyslacy123)

## Context

L28: new capabilities extend JARVIS without uncontrolled Kernel mutation. L29:
the Kernel is protected. The HEPHAESTUS brief wants JARVIS to be able to
*identify a missing capability and build it* — "need detected → research →
FORGE writes extension → JARVIS LABS → tests → static/security analysis →
human review → registration" — and is explicit: **never allow JARVIS to
autonomously mutate Kernel code in production.**

A capability adapter is not Kernel code, but an auto-authored adapter that
could self-register would be a code-execution path with attacker-influenced
content (the "research" step reads untrusted web APIs). This ADR fixes the
pipeline so that authoring is automatable but *activation* is not.

## Decision

### The pipeline

```
1. NEED DETECTED
   Orchestrator / Objective Engine emits jarvis.agency.capability_gap
   { intent, why, exampleInvocations }   -- data, not a build trigger

2. RESEARCH  (forge specialist, proposes only)
   reads target API/device docs via the `web` capability (GET-only, untrusted-
   tagged); produces a CapabilityDraftProposal { manifest, adapterSource,
   testSource, researchNotes, evidence[] }.  All of it is `derivedFromUntrusted`.

3. BUILD + TEST IN JARVIS LABS  (never anywhere else)
   the draft is materialised only inside a LABS sandbox (below); `pnpm install`
   for the adapter's declared deps runs here; unit + capability tests run here;
   a synthetic-credential integration run exercises execute/verify/rollback
   against mock APIs.

4. STATIC + SECURITY ANALYSIS  (deterministic, in LABS)
   - `tsc` strict + `scripts/lint.mjs` security lint (no process.env, no
     child_process/vm unless domain == terminal, verify present per action,
     rollback present per reversible side-effecting action, no import of
     @jarvis/{gateway,agents,world-model,memory,persistence});
   - manifest validation (ADR-0026 rules, active-intrusion denylist ADR-0028);
   - dependency audit (advisory DB) — any HIGH/CRITICAL advisory ⇒ hard fail;
   - egress declaration check — the adapter's declared network targets vs a
     static scan of its fetch/connect calls; undeclared egress ⇒ hard fail.

5. HUMAN REVIEW  (mandatory, blocking)
   the operator sees: manifest diff, adapter source, test source + LABS test
   report, static-analysis report, dependency tree, declared egress. Approve /
   reject / request-changes. Approval is a signed operator Command
   (authTrustLevel: verified).

6. REGISTRATION  (Capability Registry only)
   on operator approval the Registry validates and registers the manifest and
   records the adapter artifact hash. FORGE cannot call register; there is no
   `capability.register` capability.

7. LIVE, BUT PROBATIONARY
   the new capability enters the registry with effective
   riskClass = max(declared, HIGH) and approvalPolicy = 'always' until the
   operator marks it `reviewed-trusted` (a second, later Command). Sentinel
   flags every invocation of a probationary capability.
```

### JARVIS LABS — the sandbox (`apps/labs`)

An isolated experimentation environment. One LABS run =

- an **ephemeral Docker container** (`executionEnvironment: 'worker+container'`
  reuses this mechanism), torn down on completion or timeout (guaranteed —
  a reaper kills orphans);
- **synthetic credentials only** — a fake GitHub token against a mock GitHub,
  a throwaway Postgres, a scratch filesystem, mock HTTP endpoints for the
  target API; **no route** to the real Kernel DB, the real NATS ledger
  subjects, the Credential Broker's real material, or the real internet beyond
  an allowlisted docs-fetch proxy during step 2;
- **resource limits** — CPU, memory, wall-time, disk, max processes;
- **full logging** — every command, file write, and network attempt captured
  as the LABS run record;
- **cleanup** — container, volumes, scratch dirs, and synthetic creds
  destroyed; the only durable output is the signed LABS report + artifact
  hash.

FORGE, and any future "experiment with X" flow, runs here. Production
promotion is steps 5–7 and is entirely operator-gated.

### What remains forbidden

- JARVIS never edits `apps/core` (Kernel) source, `packages/contracts`,
  `packages/permissions`, `scripts/lint.mjs`, migrations, or any ADR/spec, in
  any automated flow. FORGE's write scope is `capabilities/<new-id>/**` inside
  LABS only.
- No automated path calls the Capability Registry's `register`.
- A capability draft that fails any of steps 3–4 is archived with its report;
  it does not get a retry loop that could brute-force the analysis.

## Alternatives considered

- **Auto-register after tests pass (no human).** The "research" input is
  untrusted; a crafted API doc could shape an adapter that passes shallow
  tests. Rejected — human review is the gate, per the brief.
- **FORGE edits the Kernel to add the capability inline.** Violates L28/L29
  outright. Rejected.
- **No probation; a reviewed capability is immediately full-trust.** A review
  can miss things; probation + Sentinel flagging gives a monitored
  introduction. Kept probation.
- **Run experiments in a bare worker (no container).** Foreign npm deps +
  arbitrary adapter code need real isolation, not just a fresh process.
  Rejected — LABS is container-based.

## Benefits

- JARVIS can close its own capability gaps end-to-end up to the review line.
- The one thing that grants power — registration — is operator-only and
  requires a signed, verified-trust Command.
- Untrusted research input never reaches a build outside the sandbox.
- Probation + Sentinel flagging bounds the risk of a subtly-bad approved
  adapter.

## Disadvantages

- A real human is in the loop for every new capability (by design; it is the
  point).
- LABS is a non-trivial sandbox to build and keep isolated; Docker must be
  available on the node that runs it.

## Risks

- **LABS escape / a synthetic run reaches real resources.** Mitigated: no real
  credentials in the container, no network route to Kernel infra, egress only
  through an allowlisted proxy in step 2, deterministic teardown + reaper,
  and the LABS network namespace is default-deny.
- **Reviewer rubber-stamps.** Mitigated: the review payload is concrete
  (diff + reports, not a summary); probation keeps the capability gated until a
  *second* explicit trust Command; Sentinel flags probationary invocations.
- **Dependency-audit DB is stale.** Mitigated: the audit DB refresh is itself
  a scheduled capability; a stale-DB condition fails the step closed.

## Consequences

- New deployable `apps/labs`; new specialist behaviour for `forge`.
- New contracts: `CapabilityDraftProposal`, `LabsRunReport`,
  `jarvis.agency.capability_gap`, `jarvis.agency.capability.probation.*`.
- `scripts/lint.mjs`: the security-lint rule set above, runnable standalone
  for step 4.
- `AGENCY_MODEL.md` gains a "Self-extension" section; `ROADMAP.md` FORGE/LABS
  row points here.

## Reversal difficulty

**Low.** Self-extension is an additive flow on top of the Registry. Removing it
means deleting `apps/labs`, the `forge` draft behaviour, and the
`capability_gap` event — the Registry and the manual capability-authoring path
are unaffected.
