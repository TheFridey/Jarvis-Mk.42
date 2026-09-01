# Roadmap — MK.42 → MK.100

How JARVIS evolves without destroying its foundations (L40). MK.42 is the
spine; every later MK **adds** through the designed extension points
(`KERNEL_CONSTITUTION.md` §4) and never rewrites the core.

---

## The invariant

For any MK.N (N > 42), these do not change without an ADR that proves the 40
laws still hold:

- The 40 laws.
- The 16 Kernel components and their ownership.
- The `Event` envelope, `Provenance`, `Fact`, `Capability`, `ModelRequest`,
  `NodeDescriptor` contract *shapes* (they version additively).
- The rule that authoritative state lives only in the Kernel's PostgreSQL.
- The Executor pipeline stages.
- The trust-boundary topology.

Everything else is expected to grow.

## What each later MK adds through existing seams

| Capability wanted | Seam it enters through | Kernel change? |
|---|---|---|
| A new AI provider | Gateway adapter + Model Registry rows | none |
| Local / on-device models | Model Registry rows `locality: local` + a local inference process | none |
| A new tool/effect | Capability manifest + out-of-process adapter | none |
| A new specialised agent | Agent manifest in `agents/*` | none |
| A new sensor / observation | New `jarvis.perception.*` signal type | none (maybe a new ingestion rule) |
| A new Experience surface (mobile, TV) | New SDK client + Node Protocol registration | none |
| A phone as a node | Node type `owned-mobile` + Node Protocol | none |
| Multi-user | Issue more principals; per-principal policy/grants; row filters | none (columns already exist) |
| Multi-device realtime media | Activate LiveKit direction (ADR-0012); `apps/relay` | none to Kernel; new infra |
| AR | Node type + pose/gaze/hands observations + spatial-UI surface capability; Scene Graph already present | none |
| Robotics / device control | Node type + CRITICAL capability manifests on a robot node; Executor already gates | none |
| Splitting the monolith | Replace an in-process module binding with NATS request/reply + own schema (`SYSTEM_BOUNDARIES.md` §10) | mechanical, no consumer change |

## Indicative phase sequence (not dates)

### MK.42 — GENESIS (this repo)
Constitution, ADRs, diagrams, inert skeleton, typed contracts. No runtime.

### MK.43 — Spine
Kernel core: Identity, Session, Event Manager (PG + outbox + NATS), State
Manager (projectors), Audit. PostgreSQL/Redis/NATS/MinIO in Compose. Contracts
become runtime-validated. Diagnostics read-only UI. **Exit criterion**: events
in, projections rebuilt on restart in < 10 s, audit trail queryable.

### MK.44 — Authority
Policy Engine (deterministic rules + property tests), Permission Engine
(grants, scopes, TTL tokens, approval workflow), Capability Registry, the
Executor pipeline with one trivial capability (`filesystem` read/write in a
workspace) end-to-end incl. simulate/verify/rollback. **Exit**: no effect
possible outside the pipeline; fail-closed proven.

### MK.45 — Cognition
Model Gateway (2+ provider adapters), Model Registry, Context Compiler with the
budget/priority-tier algorithm, `Proposal` + Validator, Agent Runtime with
`oracle`. **Exit**: swap a provider with zero Kernel/contract change; context
frames respect the hard budget.

### MK.46 — Knowledge
World Model (entities, facts, evidence, temporal queries, belief revision) and
Memory (episodes, recall, decay) as separate schemas/services. Ingestion
pipeline. `mnemosyne`. **Exit**: every fact has provenance+confidence; "I don't
know" is a real answer; conflict recorded not overwritten.

### MK.47 — Perception
`apps/voice` (wake, ASR local), `apps/vision` (presence, hands, pose),
screen/cursor telemetry, multimodal fusion in the Context Compiler. **Exit**:
raw media never leaves the workstation; wake is fully local; perception cannot
reach cognition packages.

### MK.48 — Objectives & autonomy loop
Objective Engine (decomposition, success criteria, status), Scheduler,
Notification Manager, Health Manager degradation state machine, `prometheus`.
**Exit**: JARVIS pursues a standing objective across restarts with no
conversation open.

### MK.49 — Experience
Tauri shell, multi-monitor layout, voice surface, notification surfaces,
approval UX. Full `packages/sdk`. **Exit**: interfaces hold zero authoritative
state; all mutation via validated commands.

### MK.50 — Agency breadth
`terminal`, `github`, `docker`, `web`, `browser`, `scalesmiths`,
`communications` adapters. `forge`, `scout`, `hermes`, `atlas`, `hephaestus`,
`sentinel`, `argus`, `daedalus`. **Exit**: each adapter scoped-credential only;
CRITICAL requires dual control.

### MK.51+ — Spatial & multi-node
Scene Graph population, second workstation, phone node, display node, LiveKit
for multi-node media, `apps/relay` for off-LAN nodes.

### MK.60+ — GPU node & local frontier
Dedicated inference node; privacy-classified context stays local by routing.

### MK.70+ — AR
Headset node; spatial UI surfaces; gaze/hands-first interaction.

### MK.80+ — Robotics / physical device control
Robot node; motion capabilities (CRITICAL); simulation-first mandatory;
physical-world verification.

### MK.90+ — Multi-user / delegation
Additional principals; delegation grants; true two-person control; per-
principal world models with shared entities.

## Anti-goals across all MKs

- No "temporary" shortcut that bypasses the Executor, the Validator, or the
  Policy Engine.
- No provider name in a Kernel contract.
- No agent or interface writing authoritative state.
- No security control that is only a prompt.
- No unbounded persistence.
- No microservice created before its lifecycle/blast-radius justifies it.
- No God service. If a component's ownership list grows, split it and record
  the split in `DATA_OWNERSHIP.md` §5.

## How to change the constitution

If a law genuinely must change: write an ADR that (1) states which law, (2)
shows why the current form blocks a real need, (3) proves the other 39 still
hold under the new form, (4) lists every document and contract that must be
updated, (5) states reversal difficulty. Ratify before implementing. This
document and `PRINCIPLES.md` are updated in the same change.
