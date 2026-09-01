# apps/gateway — the Model Gateway

Sole inference egress (`docs/architecture/COGNITION_MODEL.md` §2, ADR-0010).
Separate process from the Kernel by deliberate decision: it holds provider API
keys, does slow and failure-prone network IO, and must restart independently
(L26).

## Does

- Accepts provider-neutral `ModelRequest`; returns `ModelResponse`.
- Routes via `@jarvis/models` metadata + routing policy: capability match,
  budget, cost, latency, `locality`, health.
- Serialises the structured `ModelInput` to each provider's wire format via a
  `ProviderAdapter` — **the only place provider SDKs and "chat" shapes exist**.
- Circuit-breaks + times every provider call.
- Emits `jarvis.cognition.model.called` with usage metadata only (no content
  by default).
- Enforces locality: sensitive frames cannot go `cloud-ok` without a HIGH-risk
  capability approval.

## Owns

Provider credentials (process env / OS keychain). Per-provider rate-limit +
circuit-breaker state. An opt-in TTL response cache. **Nothing authoritative.**

## Must not

Write authoritative state. Make a policy decision. Persist prompt/response
content beyond the opt-in cache. Stall the Kernel on its own outage.

## Adapters

`src/adapters/<provider>/` — one file per provider implementing
`ProviderAdapter`. Local models (llama.cpp / vLLM / Ollama endpoints) are
adapters too, registered `locality: local`. Removing a provider = delete
adapter + registry rows.
