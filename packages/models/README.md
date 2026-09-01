# @jarvis/models

**Purpose.** The **Model Registry** types and the **routing-policy** library
(`docs/architecture/COGNITION_MODEL.md` §2, ADR-0010). Given a `ModelRequest`
and the registered `ModelRegistration`s, select a model by capability match,
budget fit, cost, latency, `locality`, and health.

**Owns.** The `catalogue.models` schema (registrations only — declared
capabilities, context limits, cost, locality). **No credentials.**

**Depends on.** `@jarvis/contracts` only.

**Must not.** Import a provider SDK. Hold API keys (the gateway does). Make the
inference call (the gateway does). Contain provider "chat" shapes.

**Extraction seam.** Stays with the Kernel; the gateway pulls registry
metadata over an interface.
