# Prompt 7 telemetry delivery evidence

Implemented against the current working tree on 2 October 2026. Existing Prompt 5 and Prompt 6 edits were preserved; this is not an exact-SHA release certification.

## Delivered

Prometheus, Loki, Tempo and Grafana run alongside the retained Collector. Prometheus scrapes the Collector and PostgreSQL/Redis/NATS exporters. OTLP traces reach Tempo, native OTLP structured logs reach Loki and OTLP metrics reach Prometheus. Grafana is an engineering interface with provisioned internal data sources and no Kernel authority.

The Kernel assembles fixed-query, numeric-only telemetry with fresh/unavailable states. Authenticated desktop/Experience projections carry the snapshot and bounded session history. The collapsed rail exposes CPU, GPU, RAM, actual provider tokens when reported, latency, estimated cost, agents, queue, network and Kernel health; Operations expands measurements and sparklines. Missing observations and disconnection never synthesize production values.

Sentinel uses sustained deterministic thresholds and Notification Manager. Argus reviews only otherwise unexplained sustained queue growth, through an isolated local agent with bounded time/cost and no Agency effect forwarding. Trace boundaries cover proposal, policy, permission, adapter and verification; mediated agent-worker callbacks preserve parent trace context. Log and trace export privacy gates strip arbitrary content.

## Verified locally

* Docker Compose config validated; all eleven selected infrastructure services are running.
* Prometheus targets: Collector, PostgreSQL, Redis and NATS up. Optional Windows/GPU exporters down because absent on this machine; this is a supported condition.
* `pnpm telemetry:verify` passed: emitted a labeled probe, retrieved its metric in Prometheus, its trace in Tempo and its correlated JSON log in Loki.
* `pnpm lint` passed (includes root TypeScript checking).
* `pnpm test` passed: 284 tests in 63 files.
* Contract: 16 passed. Security: 30 passed. Architecture fitness: 17 passed.
* New PostgreSQL telemetry integration: 2 passed against a disposable migrated PostgreSQL instance, including counts, unavailable usage, cache isolation and absent-trace persistence.
* Desktop production build passed, including Next.js TSX type validation.
* Browser: collapsed and expanded Operations controls functioned; disconnected values were explicitly unavailable. No provider/model credentials were needed for this check.

The initial broader integration run completed with 86 passes and one observability failure in 16 files: the new privacy allowlist dropped the existing `jarvis.probe` audit attribute. That safe attribute was restored, and a fresh focused integration run passed all seven tests across observability (5), voice (1) and system telemetry (1). The full suite was not rerun wholesale after that correction. Source/build proof is distinct from hardware acquisition, live provider inference, operator deployment and production release proof.

## Explicit availability limits

Windows does not supply Unix load averages. GPU telemetry requires a supported NVIDIA utility or an installed DCGM exporter. Host fallback probes are bounded and optional. PostgreSQL busy-connection saturation is a server-side application proxy, not driver queue introspection. Voice runtime health is supplied by authenticated ten-second heartbeats plus ingress handling observations; source values become unavailable when stale. Failed delivery is counted without storing transcript content in telemetry. No connected voice/camera or actual local-model incident review was exercised on this machine. Production authority and release remain outside this local implementation check.

See [SYSTEM_TELEMETRY.md](SYSTEM_TELEMETRY.md) for collection semantics, ports, thresholds and operation.
