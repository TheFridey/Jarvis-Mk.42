# Diagrams

Mermaid sources. Each is also embedded inline in the document that owns its
subject; these files are the standalone copies for rendering / editing.

| File | Subject | Owning doc |
|---|---|---|
| `global-architecture.mmd` | The seven planes and their traffic | `MK42_ARCHITECTURE.md` §4 |
| `kernel-components.mmd` | The 16 Kernel components + internal edges | `KERNEL_CONSTITUTION.md` §1 |
| `event-flow.mmd` | Command → event + outbox → NATS → projections/consumers | `EVENT_ARCHITECTURE.md` |
| `state-ownership.mmd` | Which component owns which store | `DATA_OWNERSHIP.md` |
| `cognition-flow.mmd` | ContextFrame → cognition → Proposal → validation → execution | `COGNITION_MODEL.md` |
| `capability-execution.mmd` | The single Executor pipeline | `AGENCY_MODEL.md` §3 |
| `perception-flow.mmd` | Sensors → local processing → observations → Compiler | `PERCEPTION_MODEL.md` |
| `world-model-interactions.mmd` | Inputs → ingestion → facts/evidence → queries | `WORLD_MODEL.md` |
| `node-architecture.mmd` | MK.42 nodes + future node types via the Node Protocol | `SYSTEM_BOUNDARIES.md` §9 |
| `trust-boundaries.mmd` | Untrusted / semi-trusted / trusted zones + crossings | `SECURITY_MODEL.md` |
