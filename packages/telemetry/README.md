# @jarvis/telemetry

**Purpose.** OpenTelemetry trace setup used by the Core and Model Gateway: a
real NodeSDK, OTLP trace export, HTTP/undici/Redis/network instrumentation, and
explicit domain spans at useful boundaries. `postgres.js` is traced explicitly
at Kernel persistence boundaries; node-postgres instrumentation is not used.
The package also provides
the **`correlationId` ↔ `traceId` bridge** so an audit trace and an OTel trace
can be cross-referenced (`EVENT_ARCHITECTURE.md` §6).

**Owns.** No business state. Telemetry goes to the OTel collector / backend,
which is outside PostgreSQL (`DATA_OWNERSHIP.md` §1).

**Depends on.** The OpenTelemetry SDK and supported instrumentation packages.

**Current limit.** This does not yet initialise every process or implement the
full metrics/logging catalogue in ADR-0036. Provider, hardware, cost, quota, and
health values remain absent unless a real producer supplies them.

**Must not.** Carry business state in spans/metrics. Be on any critical path
(telemetry is best-effort; its failure never affects behaviour).

**Extraction seam.** n/a — shared library.
