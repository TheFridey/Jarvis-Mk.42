# ADR-0010: Model Gateway as the sole inference egress

Status: Accepted
Date: 2026-08-31
Deciders: Principal Architect

## Context
L1: JARVIS is not an LLM. L3: providers are interchangeable. L26: cloud
intelligence is a resource, not identity. L30: security is architectural. If
any component can call a provider SDK directly, we get provider coupling,
scattered credentials, no central routing/observability, and a jailbroken model
adjacent to more than it should be.

## Decision
All inference — cloud or local, reasoning or embedding or transcription — goes
through a single **Model Gateway** process (`apps/gateway`). It:

- exposes the provider-neutral `ModelRequest` / `ModelResponse` contracts
  (`packages/contracts/src/model.ts`);
- is the **only** place provider SDKs and API keys exist;
- routes by Model Registry metadata + policy (capability match, cost, latency,
  `locality`, health), not by provider name;
- emits `jarvis.cognition.model.called` with usage metadata only (no content
  by default);
- circuit-breaks and times every provider call so its failure never stalls the
  Kernel.

Providers are **adapters** implementing one `ProviderAdapter` interface.
Local models are adapters with `locality: local` registry entries.

## Alternatives considered
- **Direct SDK calls from cognition/agents** — simplest, but every law above
  is violated. Rejected outright.
- **A third-party LLM proxy (LiteLLM, OpenRouter, a cloud gateway)** as the
  whole solution — useful as an *adapter target*, but we still need our own
  process for locality enforcement, our contracts, our routing policy, our
  audit events, and our credential isolation. We may point an adapter at such a
  proxy; it is not a substitute for the gateway.
- **In-process gateway module inside the Kernel** — removes a process, but
  co-locates provider keys and slow network IO with the spine, widening blast
  radius and coupling restart cycles (L26).

## Benefits
- Swapping/adding/removing a provider touches only an adapter + registry rows
  (`COGNITION_MODEL.md` §3) — the concrete proof of L3.
- One place for cost control, rate limiting, caching, redaction, and
  observability of all AI spend.
- Locality/privacy enforcement (`LOCALITY_MODEL.md` §3) has a single
  chokepoint.
- Provider keys live in exactly one process.

## Disadvantages
- One more process to run.
- The gateway is a shared dependency for all cognition (mitigated: its outage
  degrades reasoning, not the Kernel; `FAILURE_MODEL.md`).
- A thin abstraction can leak provider quirks (mitigated: structured
  `ModelInput`, abstract context units — review §16.6).

## Risks
- Abstraction that hides too much and blocks using a provider's unique
  feature. Mitigated: `capabilities[]` on `ModelRequest` lets callers require
  specific features; unusual needs get a typed extension rather than a leak.
- Gateway becomes a bottleneck. Mitigated: it is stateless per request and
  horizontally scalable; MK.42 volume is trivial.

## Consequences
- No Kernel or Cognition package may import a provider SDK.
- Prompt/response content is not persisted without a HIGH-risk capability.
- `packages/models` holds only the neutral contracts + registry types.

## Reversal difficulty
**Low.** The gateway sits behind the `ModelRequest`/`ModelResponse` contracts.
Its internals (routing, adapters) can change freely; even replacing the whole
process with a different implementation is transparent to callers as long as
the contracts hold.
