# Local observability

OpenTelemetry trace export is implemented for the Kernel and Model Gateway via
`@jarvis/telemetry`. Other processes are not claimed to initialise it.

```text
apps/core + apps/gateway -- OTLP/HTTP --> local collector --> configured trace backend
```

## Live trace coverage

- incoming Kernel and Model Gateway interactions, with remote context extraction;
- Context compilation;
- model-gateway requests and provider attempts;
- agent and capability invocations;
- useful `postgres.js` event-append transaction boundaries;
- durable event append correlation and outbox relay publishing;
- supported HTTP, undici/fetch, ioredis, and network instrumentation.

The Event Manager records the active `traceId` on canonical durable events, so
events and traces can be joined by trace and correlation IDs. Span attributes
contain identifiers and bounded operational metadata, not prompts, responses,
credentials, or raw perception media.

## Not yet claimed

The complete metrics list in ADR-0036, structured OTel logging, every process,
every Executor stage, and a production collector/backend are incomplete or
deployment-specific. There is no `node-postgres` instrumentation: this
repository uses `postgres.js`, so database coverage is explicit and bounded.

Telemetry is best-effort, non-authoritative, and never a policy, workflow, or
health authority. Missing telemetry renders as unavailable rather than being
invented by the Experience Plane.
