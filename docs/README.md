# JARVIS MK.42 — Documentation

| Directory | Contents |
|---|---|
| [`architecture/`](architecture/) | The constitution: the 40 laws, the 14 model documents, the master architecture doc with the adversarial review. **Start here.** |
| [`architecture/adr/`](architecture/adr/) | Architecture Decision Records (18). |
| [`architecture/diagrams/`](architecture/diagrams/) | Mermaid diagram sources (also embedded inline in the docs). |
| [`protocols/`](protocols/) | Wire-level protocols: the Event envelope, the Node Protocol. |
| [`security/`](security/) | Threat model and security operating notes (the model itself is `architecture/SECURITY_MODEL.md`). |

## The shortest possible summary

JARVIS is a persistent, event-driven AI **operating layer**. The Kernel
(protected, 16 components) owns all authoritative state as an Event Log +
Projected State in PostgreSQL. Perception turns sensors into observations;
Cognition (replaceable models, behind one gateway) turns context into
proposals; the Capability Executor is the only path to an effect and gates
every one through deterministic policy, permission, simulation, and
verification. Memory (experience) and the World Model (beliefs with provenance)
are separate systems. Nothing an AI model produces is trusted until validated.
Devices, AR, and robots attach as nodes without changing the Kernel.
