# @jarvis/sdk

> **README-ONLY, PLANNED EXTRACTION SEAM — NOT A WORKSPACE PACKAGE.** There is
> no general `@jarvis/sdk` implementation. Current desktop interaction uses the
> authenticated Kernel ingress plus `SceneTransport` in the Scene/Desktop code.
> New surfaces must not assume this package is available.

**Purpose.** The client library every Experience-Plane app uses
(`docs/architecture/SYSTEM_BOUNDARIES.md` §2): typed **read** subscriptions to
scoped projections + notifications, and typed **`Command` / `Proposal`**
submission. This is the *only* way an interface interacts with JARVIS.

**Owns.** Client-side connection/session state only. **No authoritative state**
(L6).

**Depends on.** `@jarvis/contracts`, `@jarvis/protocol`.

**Must not.** Expose a datastore handle. Provide any way to call a capability
adapter or a model directly. Cache authoritative data as if it were the
source. Embed policy enforcement (it may *reflect* policy state to the UI).

**Consumed by.** `apps/desktop`, `apps/diagnostics`, and every future
Experience surface (mobile, TV, AR) — new surfaces are new SDK clients, not new
Kernel code.

**Extraction seam.** n/a — it is the client.
