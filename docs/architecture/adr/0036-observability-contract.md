# ADR-0036: Observability is a contract, not a wish — a real OTel SDK, mandatory spans and metrics on the load-bearing paths, and ledger↔trace correlation; unmet parts of the "complete coverage" claim are retracted until met

Status: PARTIAL — NodeSDK, OTLP trace export, resource identity and core auto-instrumentation are implemented; complete named-path span coverage remains in progress.
Date: 2026-09-03
Deciders: External Principal Architect (ASCENSION Stage A audit), Principal (rhyslacy123)
Relates-to: ADR-0009 Amendment 1 (`traceId` on the envelope), EVENT_ARCHITECTURE §6, MK43_IMPLEMENTATION_NOTES §2; corrects `packages/telemetry`

## Context

`packages/telemetry` uses `@opentelemetry/api` with **no registered
provider**: `startTelemetry` is empty, `withSpan` runs on a no-op span,
`currentTraceId()` returns `undefined`, so the envelope's `traceId` is never
populated. There are **no metrics** — the collector config has a metrics
pipeline with no producers. `infrastructure/observability/README.md` describes
end-to-end tracing and a dozen metrics that are not emitted. The ASCENSION
prompt requires complete OTel coverage and a correlated trace from user input →
RTC → context → agent → model → capability → verification → response. See
`AUDIT_MK42_ASCENSION.md` F-OBS-1..3, F-PROC-2.

Constraint: telemetry is best-effort and on **no** critical path
(`KERNEL_CONSTITUTION.md` §2.7, `FAILURE_MODEL.md` §5) — its failure must never
change behaviour. That stays true.

## Decision

### 1. A real SDK, wired

`@jarvis/telemetry` registers `@opentelemetry/sdk-trace-node` +
`@opentelemetry/sdk-metrics` + an OTLP exporter to the collector already in the
dev stack, behind `startTelemetry(opts)` and a `JARVIS_TELEMETRY=off` kill
switch. Export is batched, async, and failure-swallowing. `currentTraceId()`
returns a real id inside an active span. The MK.43 "SDK deferred" note is
closed for `apps/core`, `apps/adapter-host`, `apps/labs`, and (when they
exist) `apps/gateway`, `apps/voice`, `apps/vision`.

### 2. Mandatory spans on the load-bearing paths

Every stage that emits a ledger event also opens a span, child of the
interaction's root span, tagged `correlationId`, `principalId`,
`jarvis.event.type`. Non-negotiable span coverage:

- **Event fabric**: `event.append`, `outbox.relay.publish`,
  `projector.apply` (per read model).
- **State**: `state.mutate` (with `slice`, `accepted|rejected`).
- **Context Compiler**: `context.compile` (with `intentClass`, `usedUnits`,
  `truncated`).
- **Executor pipeline**: one span per lifecycle transition —
  `invocation.validate`, `.policy`, `.approval.wait`, `.simulate`,
  `.freshness_barrier`, `.execute` (child span per worker spawn),
  `.verify`, `.rollback` — each tagged `capabilityId`, `action`, `riskClass`,
  `verdict`/`outcome`.
- **Credential Broker**: `credential.mint` (scope + mode + kind; **no secret**).
- **Model Gateway** (when built): `model.call` (provider, model, task, locality,
  cost, latency, tokens).
- **Node Protocol** (ADR-0037): `node.admit`, `node.heartbeat_missed`.

A fitness test (ADR-0038) fails if an Executor transition method has no
`withSpan` wrapper.

### 3. Metrics — the ASCENSION set, with a schema

`@jarvis/telemetry` exposes typed counters/histograms/gauges; producers are
wired at the emit sites:

| Metric | Type | Source |
|---|---|---|
| `jarvis.event.append.rate` by `retentionClass` | counter | Event Manager |
| `jarvis.outbox.depth` | gauge | Outbox relay |
| `jarvis.projector.lag` by read model | gauge | State Manager |
| `jarvis.bus.consumer.pending` | gauge | NATS bus |
| `jarvis.invocation.outcome` by `capabilityId`,`outcome` | counter | Executor |
| `jarvis.invocation.duration` by stage | histogram | Executor |
| `jarvis.policy.denials` by `ruleId` | counter | Policy eval site |
| `jarvis.approval.pending` / `.expired` | gauge / counter | Permission Engine |
| `jarvis.credential.mint` by `kind`,`mode` | counter | Broker |
| `jarvis.verification.failure` by `capabilityId` | counter | Executor |
| `jarvis.model.cost` / `.latency` / `.tokens` by provider | histogram | Gateway |
| `jarvis.node.health` by `nodeId` | gauge | Presence/Health |
| `jarvis.memory.rows` by `mnemosyne` class; `jarvis.world.facts.active` | gauge | Knowledge Ingestion (when built) |
| `jarvis.voice.latency`,`jarvis.hand.latency`,`jarvis.ui.latency` | histogram | perception / experience (when built) |
| `jarvis.coldstart.duration` | histogram | Kernel lifecycle |

Metrics with no producer yet (voice/hand/UI/model/memory/world) are **declared
in the schema and documented as `producer: pending`** — not silently absent.

### 4. Ledger ↔ trace correlation

Every non-TRANSIENT event carries `traceId` (from `currentTraceId()`), already
a field. `DiagnosticsService` and the future Audit Manager expose
`traceFor(correlationId)` and `eventsFor(traceId)`. The ASCENSION E2E demo
(hardening spec H-E2E) must be reconstructable from **either** the
`correlationId` event tree **or** the OTel trace, and the two must agree.

### 5. Retract what is not yet true

`infrastructure/observability/README.md` and any doc that says "every process
initialises tracing" / "complete OpenTelemetry coverage" is edited to state
exactly which processes and which spans/metrics are live, and which are
`pending`. When the ASCENSION wiring lands, the doc is updated to match, not
ahead of, reality.

## Alternatives considered

- **Keep the no-op shim; rely on structured logs + the event ledger for
  observability.** Rejected — the ledger has no timing/latency data and no
  cross-process span tree; the ASCENSION trace requirement needs real spans.
- **Full auto-instrumentation (`@opentelemetry/auto-instrumentations-node`).**
  Rejected as the primary mechanism — it produces noisy HTTP/fs spans without
  the domain tags (`correlationId`, `capabilityId`) that make a JARVIS trace
  useful. Manual spans at the ledger-emit sites first; auto-instrumentation is
  optional on top.

## Benefits

- The ASCENSION end-to-end trace becomes real and testable.
- Regressions (latency, cost, denial rate, verification failures) are visible.
- Docs stop describing observability that does not exist.

## Disadvantages

- SDK dependencies re-enter the tree (the MK.43 "external drive" reason for
  deferring is no longer binding — `node_modules` is present, tests run in
  4.5 s).
- Span wrapping on every Executor transition is boilerplate (mitigated by a
  single `withSpan` helper per transition).

## Risks

- **A misbehaving exporter stalls a hot path.** Mitigated: batch span
  processor, bounded queue, drop-on-full, export on a timer off the request
  path; `JARVIS_TELEMETRY=off`.
- **PII/secret leakage into span attributes.** Mitigated: an attribute
  allowlist per span name; the broker/redactor (ADR-0035) runs over any string
  attribute; no prompt/response content, no `input`, no secret ever set as an
  attribute — enforced by the same fitness test that checks span coverage.

## Consequences

- `packages/telemetry`: real SDK registration + typed metric instruments.
- `apps/core`, `apps/adapter-host`, `apps/labs`: `startTelemetry` in `main.ts`;
  spans at the §2 sites; metrics at the §3 sites.
- `infrastructure/observability/`: collector config gains a metrics exporter to
  a real (local) backend; README rewritten to match live coverage.
- `MK43_IMPLEMENTATION_NOTES.md` §2: the OTel row moves from "deferred" to
  "restored for `apps/core` + agency; perception/gateway pending".
- ADR-0038 fitness test: Executor transition without a span ⇒ fail; secret/PII
  span attribute ⇒ fail.

## Reversal difficulty

**Low.** Telemetry is on no critical path; the SDK can be swapped or disabled.
The span/metric *names* become a soft contract for dashboards — additive.
