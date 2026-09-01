# ADR-0014: Local-first computation, cloud as a resource

Status: Accepted
Date: 2026-08-31
Deciders: Principal Architect

## Context
L25–L27, L36, L39: realtime and privacy-sensitive processing must be local;
cloud intelligence is a replaceable resource, not identity; JARVIS must
function when cloud/internet is gone. We need an explicit placement policy so
this is enforced, not aspirational.

## Decision
Adopt the placement policy in `LOCALITY_MODEL.md`:

- **On-device (workstation)**: wake, VAD, ASR, hands, pose, presence, screen/
  cursor telemetry, the `windows` adapter, the desktop shell, diagnostics.
  Continuous camera/mic never leave the host.
- **Local server**: the entire Kernel, the Model Gateway, PostgreSQL, Redis,
  NATS, MinIO, OTel, most capability adapters, the agent worker pool. All
  authoritative state.
- **Cloud**: frontier model inference only, via the gateway.
- `ModelRequest.locality` (`local` | `prefer-local` | `any` | `cloud-ok`) is
  honoured by the gateway. Context flagged sensitive by the Context Compiler is
  forced to at least `prefer-local` and cannot go `cloud-ok` without a
  HIGH-risk capability approval.
- The Kernel's core decision loop runs with **zero cloud reachability**
  (degraded intelligence, full identity and authority).

## Alternatives considered
- **Cloud-first (Kernel or state in cloud)** — better burst compute and
  managed ops, but violates L25/L26/L27 and makes JARVIS non-functional
  offline. Rejected.
- **All-local, no cloud models** — maximal privacy/resilience, but forfeits
  frontier reasoning quality that local models can't yet match. We keep cloud
  as an *optional* resource, degradable.
- **Per-request manual placement only (no policy)** — error-prone; a single
  slip leaks sensitive context. We want a policy default + explicit override.

## Benefits
- Privacy and latency guarantees are structural.
- Offline resilience is real and testable (`FAILURE_MODEL.md` §Internet
  offline).
- Provider independence: cloud can vanish without touching identity/state.

## Disadvantages
- Requires running real infrastructure on a local server (ops burden on the
  operator).
- Local models (when added) need GPU resources for good quality.
- Some tasks are simply better in cloud; offline mode is genuinely degraded.

## Risks
- Sensitive context leaking to cloud via a mis-flagged frame. Mitigated:
  Context Compiler sensitivity classification + gateway enforcement + audit of
  every `model.called` with locality.
- Operator under-provisions the local server. Mitigated: MK.42 resource
  requirements documented; the Kernel's core loop is deliberately lightweight.

## Consequences
- The gateway enforces locality; cognition handles `locality: local`
  unavailability by degrading, never by silently going to cloud.
- Adding a GPU node (`ROADMAP.md` MK.60+) is how local frontier reasoning
  arrives, via registry entries only.

## Reversal difficulty
**Moderate.** Moving the Kernel/state to cloud later would be a deliberate
re-hosting (containers already; add managed Postgres/NATS) but would require
re-examining L25–L27. Moving *more* local (GPU node) is Low and already on the
roadmap.
