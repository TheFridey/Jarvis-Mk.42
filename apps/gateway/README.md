# Model Gateway

`apps/gateway` is JARVIS's sole model-provider egress. It is a separate process
because it owns provider credentials and failure-prone network I/O; it owns no
authoritative JARVIS state.

The operational runtime accepts provider-neutral `ModelRequest` values, routes
by task, capabilities, realtime/deep-reasoning fit, locality, privacy, explicit
cloud permission, availability, context, tool support, latency, cost, and
operator preference, then returns `ModelResponse` with usage, latency and
cost. It provides cancellation, deadlines, health checks, streaming at the
gateway API boundary, and per-model circuit breakers.

Adapters exist for OpenAI, Anthropic, and local OpenAI-compatible servers such
as Ollama, vLLM, and llama.cpp. Provider wire shapes and keys do not leave this
process. Sensitive or restricted context is forced to local models.

Run with `pnpm gateway:dev`. Configure one or more of `OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, or `JARVIS_LOCAL_MODEL_URL`. Core connects through
`JARVIS_MODEL_GATEWAY_URL` and `JARVIS_GATEWAY_TOKEN`. Cloud routing is
fail-closed unless Core is started with `JARVIS_MODEL_CLOUD_ALLOWED=true`.
