# @jarvis/capabilities

**Purpose.** The **Capability Registry** and the **Capability Executor**
pipeline (`docs/architecture/AGENCY_MODEL.md`, ADR-0016). The Registry holds
versioned `Capability` manifests. The Executor is the **only path to an
effect**: validate → policy → permission → freshness barrier +
`capability.started` → resource lease → simulate (if `riskClass >= HIGH`) →
execute → **verify** → emit result → rollback / saga-compensate on failure.
Also defines the out-of-process **adapter host contract**.

**Owns.** The `catalogue.capabilities` schema. The Executor's per-invocation
state and `resourceKey` leases.

**Depends on.** `@jarvis/contracts`, `@jarvis/permissions` (Policy + Permission
Engines), `@jarvis/events`, `@jarvis/validation`.

**Must not.** Execute an adapter without the full pipeline. Skip `verify`.
Auto-execute CRITICAL, or HIGH without approval + simulate. Let an adapter hold
a broad credential or emit ledger events. Fall back to ALLOW when an approver
is unreachable — **fail closed**.

**Extraction seam.** The Executor stays with the Kernel (it needs Policy +
Permission + Events transactionally). Adapters are already separate processes,
placed on the node where their resource lives.
