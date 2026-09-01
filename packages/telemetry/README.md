# @jarvis/telemetry

**Purpose.** OpenTelemetry setup shared by every process: tracer/meter/logger
initialisation, the OTLP exporter config pointing at the local collector, and
the **`correlationId` ↔ `traceId` bridge** so an audit trace and an OTel trace
can be cross-referenced (`EVENT_ARCHITECTURE.md` §6).

**Owns.** No business state. Telemetry goes to the OTel collector / backend,
which is outside PostgreSQL (`DATA_OWNERSHIP.md` §1).

**Depends on.** `@jarvis/contracts` (for `CorrelationId`), the OpenTelemetry
SDK.

**Must not.** Carry business state in spans/metrics. Be on any critical path
(telemetry is best-effort; its failure never affects behaviour).

**Extraction seam.** n/a — shared library.
