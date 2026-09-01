# @jarvis/contracts

**Purpose.** The single source of truth for the shapes that cross JARVIS
boundaries: the `Event` envelope, `Provenance`, `Fact`/`Entity`,
`Observation`, `ContextFrame`, `Proposal`, `Capability`, `Policy`/`Permission`,
`Objective`, `Model*`, `Node*`, `Audit*`.

**Owns.** Nothing at runtime. Types only.

**Depends on.** Nothing. This package is a **leaf** of the dependency graph
(ADR-0007). It must never import another `@jarvis/*` package.

**Must not.** Contain implementation, validation logic (that is
`@jarvis/validation`), provider-specific shapes (no "chat messages" — review
§16.6), or runtime constants beyond trivial lookup tables like
`RISK_TO_AUTHORITY`.

**Evolution.** Additive only. New optional fields bump a `schemaVersion` where
relevant. Breaking changes require an ADR and a migration plan
(`docs/architecture/ROADMAP.md` → "How to change the constitution").

**Consumed by.** Every `apps/*` and most `packages/*`. A version mismatch here
is a critical bug, which is why it lives in the monorepo with `workspace:*`
resolution and no independent publishing in MK.42.

## Files

| File | Contract |
|---|---|
| `common.ts` | Primitive aliases (`Ulid`, `Timestamp`, `PrincipalId`, `Known<T>`, …) |
| `provenance.ts` | `Provenance`, `EpistemicStatus` — mandatory on every fact & event |
| `event.ts` | `Event<T>`, `Command<T>` — the atom of the system |
| `entity.ts` | `Entity`, `EntityRelationship` |
| `fact.ts` | `Fact`, `Evidence`, `FactConflict`, `ScoredFact` |
| `observation.ts` | `Observation<T>`, `ObservationRef` — perception output |
| `context-frame.ts` | `ContextFrame` + its hard `ContextBudget` |
| `proposal.ts` | `Proposal` union, `ValidationResult` — cognition output |
| `capability.ts` | `Capability` manifest, `CapabilityInvocation`, `InvocationResult` |
| `policy.ts` | `PolicyQuery`, `PolicyDecision`, `PolicyRule` |
| `permission.ts` | `Grant`, `AuthorityToken`, `ApprovalRequest`, `RISK_TO_AUTHORITY` |
| `objective.ts` | `Objective`, `ObjectiveTransition` |
| `model.ts` | `ModelRequest`, `ModelResponse`, `ModelRegistration` |
| `node.ts` | `NodeDescriptor`, `NodeAdmission`, `NodeLiveness` |
| `audit.ts` | `AuditRecord`, `AuditTrace` |
