# @jarvis/validation

**Purpose.** The **Validator** (`docs/architecture/SECURITY_MODEL.md` §4,
ADR-0018). Sits on every untrusted → Kernel path: model output, agent output
(pre-validation), fetched web/external content, inbound `Command`/`Proposal`
from Experience surfaces.

Responsibilities:
- schema validation against `@jarvis/contracts` shapes + per-`type` payload
  schemas;
- safety checks (size, shape, disallowed structures);
- **provenance-tainting**: mark anything whose evidence chain includes
  untrusted content with `derivedFromUntrusted = true` and propagate it onto
  downstream effects and facts.

**Owns.** No state. The schema registry + validation rules.

**Depends on.** `@jarvis/contracts`.

**Must not.** Be a security *classifier model* substitute — a model may be one
input, never the boundary. Be bypassable: there is no "trusted fast path" for
model/agent/web input.

**Extraction seam.** Co-locates with Kernel ingress; if ingress is extracted,
the Validator goes with it.
