# @jarvis/permissions

**Purpose.** Two Kernel components (`docs/architecture/SECURITY_MODEL.md` §3):

- **Policy Engine** — a **pure, deterministic** evaluator:
  `(actor, action, riskClass, context) → ALLOW | DENY | REQUIRE_APPROVAL`,
  plus the rule DSL/AST and its property tests. No network, no model calls, no
  side effects (L20). An LLM `PolicyRecommendation` may be one typed input,
  never the verdict (L21).
- **Permission Engine** — grants, scopes, TTL'd authority tokens, elevation,
  approval + dual-control workflows; enforces the `RISK_TO_AUTHORITY` tier
  table; supplies the grant **version** the Executor re-reads at its freshness
  barrier.

**Owns.** `policy.rules` (versioned) and `projections.grants` (+ the grant
event stream). Authority tokens live in Redis with a durable issuance event.

**Depends on.** `@jarvis/contracts`, `@jarvis/events`, `@jarvis/state`.

**Must not.** Make the Policy Engine non-deterministic (no config can). Let a
model output be returned as a decision. Issue an authority token without a
matching current grant version. Default to ALLOW on approver-unreachable.

**Extraction seam.** Stays with the Kernel — decisions must be transactional
with `capability.started`.
