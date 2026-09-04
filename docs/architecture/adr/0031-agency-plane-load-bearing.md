# ADR-0031: An agency control is not real until it is wired into the running Kernel and covered by a pipeline test; documentation must say which state each subsystem is in

Status: Accepted
Date: 2026-09-03
Deciders: External Principal Architect (ASCENSION Stage A audit), Principal (rhyslacy123)
Relates-to: ADR-0016, ADR-0025, ADR-0026, ADR-0027, ADR-0028, ADR-0029, ADR-0030

## Context

The HEPHAESTUS ADRs (0025–0030) describe a correct safe-agency system. The code
committed under them (`CapabilityExecutor`, `CredentialBroker`,
`PermissionManager`, `CapabilityRegistry`, `SentinelDetectorService`,
`runGuardianPlaybook`) is imported by **nothing** — not the Kernel composition
root, not each other, not any pipeline test. `docs/security/threat-model.md`
T16–T28 and `SECURITY_MODEL.md` §3–§8 describe these controls in the present
tense as structural mitigations. In the running system they mitigate nothing
because there is no running Executor. See `AUDIT_MK42_ASCENSION.md` F-AG-1,
F-SEC-1, F-PROC-1.

The forces:

- A security architecture that is *documented as enforced* but *actually inert*
  is worse than one documented as "not built", because reviewers and operators
  make decisions against the document.
- The agency plane was built before its upstream collaborators (Validator,
  Agent Runtime, Objective Engine, Model Gateway). It has no proposal producer.
- Laws at stake: L18 (every consequential action permissioned — vacuous with no
  Executor), L29 (Kernel protected — violated by in-process adapters), L30
  (security architectural, not prose), L31 (auditable — no real agency events),
  L40 (evolve without destroying foundations — a hollow foundation is not one).

## Decision

### 1. The "load-bearing" rule

A control (a policy check, a permission gate, verification, an isolation
boundary, a detector) **may be described in `SECURITY_MODEL.md`,
`AGENCY_MODEL.md`, `SENTINEL_MODEL.md`, or `docs/security/threat-model.md` as an
enforced structural mitigation only when all of the following hold**:

1. it is constructed and wired in `apps/core/src/kernel/lifecycle/kernel.ts`
   (or another committed composition root that the running process uses);
2. its enforcement is exercised by an automated test that drives the **real
   pipeline object** (not the isolated pure helper) and asserts the control
   fires — e.g. a `CapabilityExecutor` built with fakes that asserts
   `DENY ⇒ DENIED`, `REQUIRE_APPROVAL ⇒ does not proceed`, Executor-run verify,
   freshness-abort;
3. the collaborators it depends on to receive input exist at least in a minimal
   synthetic form (see §3).

Until then the control is marked `Status: design-only` and the corresponding
threat-model row carries `Enforcement: design-only` (see §2).

### 2. Threat-model and security-doc enforcement-status column

`docs/security/threat-model.md` gains a column `Enforcement` with values:

- `enforced` — meets the §1 load-bearing rule;
- `partial` — some stages wired and tested, others not (list which);
- `design-only` — no running enforcement.

`SECURITY_MODEL.md` §10 and `AGENCY_MODEL.md` §3/§13 gain the same tagging on
each mitigation. `AUDIT_MK42_ASCENSION.md` §3 is the current snapshot;
ASCENSION Stage B updates every row it moves to `enforced`.

### 3. Minimal synthetic upstream to make the Executor testable

ASCENSION builds the **smallest** upstream that lets the real pipeline run and
be tested — not the MK.45/48 breadth:

- **Proposal ingress.** One authenticated internal entry point that accepts a
  typed `CapabilityInvocationProposal`, runs it through the real Validator
  (schema + evidence-trust ⇒ `derivedFromUntrusted`), and hands it to the
  Executor. No natural-language, no model. This is the seam the future
  Cognition Orchestrator plugs into.
- **Leased actor minter.** A single function that is the *only* constructor of
  an `EventActor` with `kind: 'agent'`, stamping `onBehalfOf` from a lease
  record, never from caller-supplied data (closes F-AG-11). Until an Agent
  Runtime exists, it issues leases for a fixed internal test actor only.
- **Policy rule store + grant store + broker material** loaded from committed
  config / the secrets file (ADR-0035) at Kernel start and passed to the
  Executor.

### 4. Wiring is an exit gate

ASCENSION does not complete until `kernel.ts` constructs and starts: the
Capability Registry (PG-backed), the Policy Engine with the base rule pack, the
Permission Engine (PG-backed grants), the Capability Executor (durable store,
ADR-0033), the Credential Broker (ADR-0035), the Adapter Host client
(out-of-process, ADR-0025 §3), the Sentinel detector service (subscribed to the
SECURITY/AUDIT streams), and the Guardian playbook (wired to the GUARDIAN mode
transition) — and one real capability (`filesystem` write in a workspace) runs
end to end through that wiring in an integration test with an out-of-process
worker, a real approval, and Executor-run verification.

### 5. Documentation honesty for every subsystem

Every `*_MODEL.md` and the design specs gain a `Status:` line at the top with
one of: `ratified` (design accepted, not built), `partial` (list what is built),
`load-bearing` (built, wired, tested per §1), `prototype` (a demo, not on the
authoritative path — e.g. `apps/desktop` experience per F-EXP-1). The design
spec component map (`apps/core/src/kernel/policy/` etc.) is reconciled against
the actual tree.

## Alternatives considered

- **Leave the agency modules unwired and trust the docs will be read with the
  ADR dates in mind.** Rejected — the threat model does not carry dates on its
  rows and is read as current truth.
- **Delete the unwired agency code and rebuild during MK.44.** Rejected — the
  modules are close to correct; the gap is wiring, durability, and three
  specific enforcement holes (ADRs 0032–0035), not the shape.
- **Wire it as-is (in-process adapters, auto-approval) to "make it real" fast.**
  Rejected outright — that ships the hollow controls into the running system,
  which is the worst outcome.

## Benefits

- The threat model stops overstating the system's security posture.
- One real end-to-end capability invocation becomes the regression anchor for
  every future adapter.
- The Executor's upstream seam is defined, so MK.45's Cognition Orchestrator
  has a contract to build against.

## Disadvantages

- Adds a documentation-status discipline to every model doc and every
  threat-model change.
- The synthetic proposal ingress is throwaway-ish scaffolding (but small, and
  it defines a real seam).

## Risks

- **The enforcement-status column is not kept current.** Mitigated: a fitness
  test (ADR-0038) fails if a threat-model row says `enforced` and no test
  references the control's pipeline object.
- **"Minimal synthetic upstream" grows into a shadow Cognition layer.**
  Mitigated: §3 forbids NL/model input; the ingress accepts only a typed
  proposal.

## Consequences

- `docs/security/threat-model.md`, `SECURITY_MODEL.md`, `AGENCY_MODEL.md`,
  `SENTINEL_MODEL.md`: gain enforcement-status tagging.
- Every `docs/architecture/*_MODEL.md` and `docs/superpowers/specs/*`: gain a
  `Status:` line.
- `apps/core/src/kernel/lifecycle/kernel.ts`: gains agency wiring (exit gate).
- New: a synthetic proposal-ingress module and a leased-actor minter.
- ADR-0038 adds a fitness test that ties `enforced` rows to pipeline tests.

## Reversal difficulty

**Low** for the documentation discipline. **Moderate** for the wiring — once
adapters run through the real Executor, unwiring it would regress L18. The
synthetic ingress is Trivial to replace with the real Orchestrator.
