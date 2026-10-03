# System telemetry and Operations

The Kernel owns the numeric Experience projection. Grafana is an operator engineering interface and has no grants, policy, permission, event-writing or execution authority. Desktop uses its existing session-bound `desktop.read` / `experience.read` boundary; it never queries Prometheus, Loki or Tempo.

## Run locally

`pnpm stack:up` retains PostgreSQL, Redis, NATS, MinIO and the Collector and starts Prometheus (127.0.0.1:9090), Loki (3100), Tempo (3200), and Grafana (3300). Grafana uses its own operator login. Provisioned data sources are internal Docker URLs. Local development database credentials remain development-only. Observability ports bind loopback. Persistence volumes survive stack:down; retention is seven days. The stack uses pinned versions, not floating latest tags for the added services.

Applications export traces, stage metrics and sanitized structured logs to the Collector on OTLP HTTP 4318. Collector routes traces to Tempo, logs through Loki native OTLP and metrics to its internal Prometheus exporter. Set JARVIS_OTLP_ENDPOINT and JARVIS_PROMETHEUS_URL at the trusted composition root to change endpoints. No URL or PromQL is accepted from Experience.

`pnpm telemetry:verify` emits a clearly labeled smoke probe and verifies its metric, trace and correlated structured log through the real Collector and all three backends. It fails if any backend does not ingest. It does not invoke a model provider.

## Measurements and semantics

* Physical host: CPU delta (first sample unavailable), RAM and Unix load via Node os. Windows disk usage and network throughput via bounded native CIM probes or optional windows_exporter (9182). Windows load is unavailable because os.loadavg is unsupported. These are physical Kernel host metrics, not Docker VM metrics.
* GPU: optional nvidia-smi with fixed arguments and a timeout, or DCGM exporter on 9400. Utilization/temperature use the busiest/hottest GPU; memory/power are summed. Unsupported values remain null. No GPU is a supported runtime condition.
* PostgreSQL: real ping latency, database bytes, connection count/capacity and server saturation, Kernel application busy connections divided by configured pool capacity, event/outbox depth. Busy connection saturation is an observed server-side proxy, not a postgres.js waiting queue measurement; waiting queue remains unavailable.
* Redis: ping connection/latency plus exporter memory/client count. In-process no-Redis mode never claims Redis connectivity.
* NATS: transport health remains under the existing recovery coordinator; real JetStream server/consumer metrics include streams, stored bytes, pending and redelivered messages. In-process bus is not represented as a healthy NATS connection.
* Gateway: measured provider-stage calls/errors/active/duration counters, provider health and open circuit counts from actual health probes. Provider latency averages require enough counter history; no fabricated zero baseline.
* Agents: durable live leases, queued jobs, failures over 24 hours, expired active leases and measured completion latency. Agency state counts come from invocations.
* Model usage: tokens require provider token counts; context units are not silently relabeled as tokens. User-run cost is explicitly an estimate in configured cost units over 24 hours. Gateway process cost also includes operational reviews and resets when the gateway restarts. Completion latency is a measured 24-hour average.
* Vision: fresh runtime status, inference latency and dropped frames. Voice: authenticated ten-second runtime heartbeats report input readiness, device state, observation processing latency and failed observation-delivery count. Ingress also records handling latency. Absent/stale observations remain unavailable. Bounded-ring history evictions are not relabeled as dropped processing.

Sampling is cached for ten seconds and coalesces concurrent requests. Prometheus queries have two-second timeouts; SQL probes have cancellation deadlines. History is bounded to 120 session samples and emitted through the existing telemetry Experience channel. Sparklines break at unavailable samples. The rail hides readings on disconnection or after thirty seconds without a fresh snapshot. This is session history, not a persistent frontend-accessible time-series API.

## Privacy and traces

Structured logs include correlationId, optional causationId, traceId, component and node. They accept identifiers and numeric duration only, never arbitrary message/payload/exception fields. Trace export drops exception events, links, error messages, SQL, URLs and unapproved attributes. Static stage names and a bounded identifier allowlist survive. Logs are JSON on stdout and native OTLP to Loki. Outbound metric/log transport is capped at eight concurrent exports with two-second deadlines; failures and dropped exports are visible in Kernel telemetry diagnostics. Telemetry backend outages do not turn logging into unbounded work.

The actual synchronous interaction path spans ingress, context compilation, agent invocation, mediated gateway/provider request, proposal, policy, permission, executor, adapter and verification where those calls occur. Agent worker IPC explicitly restores the parent trace for the mediated request. Existing ledger traceId stamping links durable events. Separate approval-resume interactions get a new trace and preserve proposal/correlation identifiers; waiting for human approval is not a fabricated continuously active span.

## Sentinel and Argus

Sentinel checks sustained fresh CPU/RAM/disk/connection saturation, expired leases, GPU temperature and NATS redelivery thresholds. Connection failures need two samples; resource thresholds need three. Cached samples do not count twice. Missing GPU telemetry never escalates. Alerts pass through Notification Manager and its interruption/dedupe policy.

Only three consecutive queue increases while PostgreSQL and Redis probes are healthy qualify for ambiguous review. Argus requires a policy-permitted local model, receives numeric evidence only, has a ten-second / 0.05 cost budget, permits one review per fifteen minutes and one in-flight review. The reviewer invokes the isolated Agent Runtime and records its job evidence, but never forwards any capability proposal to Agency. Notification Manager announces the diagnostic result. If there is no local model, deterministic monitoring continues and no cloud fallback occurs.

## Backend references

Collector routing uses [Loki native OTLP](https://grafana.com/docs/loki/latest/send-data/otel/) and the [Prometheus exporter](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/exporter/prometheusexporter/README.md). JetStream metric names were checked against the [pinned NATS exporter source](https://github.com/nats-io/prometheus-nats-exporter/blob/v0.15.0/collector/jsz.go) and the running Prometheus instance.
