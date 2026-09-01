# infrastructure/observability

OpenTelemetry end to end. Every process initialises tracing/metrics/logging via
`@jarvis/telemetry` and exports OTLP to the local collector.

## Pipeline

```
apps/* + packages/* ---OTLP---> otel-collector (local server) ---> local backend
                                                              \--> (future) remote APM
```

## What is instrumented

- **Traces**: one span tree per interaction, tagged with `correlationId` in
  `meta.traceId` so an OTel trace and an `AuditTrace` cross-reference
  (`EVENT_ARCHITECTURE.md` §6).
- **Metrics**: event append rate by class, outbox depth, projector lag per read
  model, JetStream consumer pending, capability-invocation outcomes,
  model-gateway cost/latency/tokens per provider, agent lease outcomes, Health
  degradation state.
- **Logs**: structured, correlation-tagged. No prompt/response content, no
  secrets, no raw perception media.

## Boundaries

- Telemetry is **best-effort** and on **no** critical path — its failure never
  changes behaviour.
- Telemetry is **not** business state — it lives outside PostgreSQL
  (`DATA_OWNERSHIP.md` §1).
- `diagnostics` reads metrics/traces for the operator view; it does not mutate
  anything.
