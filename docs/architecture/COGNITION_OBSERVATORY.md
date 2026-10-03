# Cognition Observatory

Status: **PARTIAL — IMPLEMENTED SUBSET NOT LIVE-PROVIDER-VERIFIED**.

The Cognition Observatory is a read-only Experience Plane view of real Model
Registry and Model Gateway decisions. It introduces no routing authority. The
Gateway evaluates candidates; the Kernel records the observation on the
Kernel-owned `cognition.runs` row and emits canonical cognition lifecycle events
through the Event Manager. The Experience Projection reads that record.

## Durable and observational data

The selected route, correlation, agent, task/privacy classes, objective or
workflow references, terminal status and completion/error lifecycle belong to
the durable cognition run. Candidate scores, rejection explanations, provider
health, circuit state and optional usage fields are structured observations.
They explain a decision but cannot authorise it or mutate Kernel state.

The existing `jarvis.cognition.model.selected` event remains Kernel cognition
owned, schema version 1, retention `AUDIT`. Its explicit payload schema permits
observed attempt phases and candidate explanations. The envelope keeps the
cognition request ID as causation, the request correlation ID, authenticated
principal, agent actor and Event Manager provenance. No Gateway-owned canonical
event or UI-animation event was added. Completion/rejection remain the existing
cognition lifecycle events. A failed provider attempt is distinguished from a
failed Kernel validation/persistence operation; only the former permits fallback.

Migration `0014_cognition_observability.sql` is forward-only and owned by the
Kernel cognition subsystem. It adds routing and usage JSON plus optional timing
and reference columns to the existing run table; it creates no new authority.

## Truth rules

- Context and output units remain abstract Gateway budget units.
- `inputTokens`, `cachedTokens`, `outputTokens`, actual cost and tokens/second
  appear only when an adapter/provider supplies or measures them.
- Estimated cost is labelled as estimated and uses registered model pricing.
- Provider quota, local queue, GPU and VRAM show `UNAVAILABLE` unless telemetry
  supplies them.
- Provider credentials and request secrets never enter the routing contract.
- `STREAMING` and `TOOL_WAIT` presentation states are reserved for genuine
  lifecycle observations; the current non-streaming cognition path does not
  fabricate them.

The Model Rail consumes realtime cognition-channel updates. The authenticated
Gateway SSE response carries actual execution observations: candidate evaluation,
provider attempt start, fallback, completion and terminal failure. The Kernel
persists each observation before emitting through the Event Manager. A preflight
inspection is not treated as a selected attempt. Transport writes honour drain
backpressure and disconnect cancellation. Observation/persistence errors propagate
and never trigger provider fallback. Endpoint health is unknown until probed.
Disconnected Model Rail data is explicitly stale, not live activity.
Cached work is withheld from Core motion and sounds while disconnected. The GPU
environment applies a connection-degraded, low-power render overlay without
changing Kernel mode or the authoritative Semantic Scene.

Dedicated Core-to-resource spatial routing choreography, first-token streaming,
standby catalogue outside a run and session-wide usage aggregation remain PARTIAL
or deferred. Candidate highlighting is driven by observed route state, not timers.
The Model Rail contains a bounded route diagram: candidate branches, rejected
branches, selected/fallback route and return path. Its finite transition pulse is
keyed to an observed phase change, disabled when stale or reduced-motion, and
never repeats to imply token streaming. The diagram is a render representation,
not spatial authority. Cost figures retain registered cost units; currency is
not inferred.

Live provider credentials, first-token streaming, provider quota APIs, and
local GPU/VRAM/queue telemetry were not exercised in this implementation pass.
The legacy abstract-unit budget and configured cost scoring were preserved;
these figures are not certified provider billing or token-window occupancy.
