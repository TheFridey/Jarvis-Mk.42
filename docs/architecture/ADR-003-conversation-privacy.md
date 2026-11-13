# ADR-003 · Conversation privacy and cloud authorisation

Status: **Proposed — the current behaviour is preserved unchanged.**
Date: 2026-11-13
Supersedes: nothing. Extends `ENGINEERING-CONTRACT-V1.md` and the routing policy in
`apps/core/src/kernel/cognition/cognition-orchestrator.ts`.

## Context

A turn that carries a `conversationId` is forced to `locality: 'local'` and
`cloudAllowed: false` (`companion-service.converse`). The product owner requires
cloud-backed conversations to be possible *with permission*, and requires that the
existing safeguard is not removed to achieve it.

Three facts from the actual source decide this ADR.

**1. Sensitivity is already classified, but per turn and per context — not per
conversation.** `context.compile(...)` returns `maxPrivacyClass` over the compiled
context, and the orchestrator acts on it:

```ts
const pc = context.maxPrivacyClass, sensitive = pc === 'SENSITIVE' || pc === 'RESTRICTED';
if (pc === 'RESTRICTED' && !localModelAvailable()) throw new Error('… refusing to route (privacy fail-closed)');
const locality = sensitive ? 'local' : (req.locality ?? 'any');
const cloudAllowed = sensitive ? false : (req.cloudAllowed ?? this.d.cloudAllowed);
```

So the real guard is *content-derived*, which is stronger than a conversation flag: a
conversation whose history pulls in RESTRICTED business knowledge compiles to RESTRICTED
and is refused a cloud route outright. `PrivacyClass` is
`PUBLIC | INTERNAL | SENSITIVE | RESTRICTED` (`packages/contracts/src/event.ts`), and
domains already carry `crossDomainPrivacyCeiling`.

**2. The conversation itself has no classification and no provider binding.**
`experience.conversation_turns` (migration `0017`) holds
`turn_id, conversation_id, principal_id, source_node_id, input, command_hash,
cognition_input, answer, response, status, created_at, finished_at, domain_id`. There is
no `privacy_class`, no `privacy_mode`, no provider authorisation, no revocation. The
privacy class computed for a turn is written to `cognition.runs`, not to the turn.

**3. Consequently a per-conversation cloud grant cannot be evaluated today, only
assumed.** Nothing durable records "this conversation was private when it was written",
so any future cloud mode could not prove that older turns are safe to include — which is
precisely the requirement "changing a setting must not silently release older private
history".

## Decision

1. **Do not remove the local-only rule.** It stays exactly as implemented.
2. **Do not implement a conversation privacy mode in this pass.** A mode without durable
   per-turn classification would be a UI promise the database cannot keep.
3. Adopt the following model as the target, to be implemented only together with the
   schema in §Implementation.
4. Keep the authority of the context ceiling above any conversation mode: a conversation
   may be *downgraded* by its content, never upgraded.

## Target model

| Mode | Inference locality | Context eligible for cloud | Default |
|---|---|---|---|
| `PRIVATE` | local only | none | **yes** |
| `CLOUD_PERMITTED` | the named provider only | this conversation's turns whose `privacy_class <= INTERNAL`, plus no tool results above `INTERNAL` | no |
| `HYBRID` | local for sensitive, cloud for the rest | only policy-approved fragments, each carrying its class | no |

Rules that bind the modes:

- **Explicit grant.** Entering `CLOUD_PERMITTED` requires an operator action naming the
  provider (and model), recorded with principal, conversation, timestamp and expiry.
- **Provider identity is part of the grant.** A different provider is a different grant;
  routing must fail closed rather than "try the next one".
- **No retroactive widening.** Turns are classified when written. A mode change applies
  to turns created after it. History above the grant's ceiling stays local-only, and a
  request that would need it is refused, not silently trimmed.
- **Unknown sensitivity fails closed.** Missing or malformed classification is treated as
  `RESTRICTED` for routing purposes.
- **Independently classified artifacts.** Tool results, capability outputs and retrieved
  knowledge keep their own class; a conversation grant never covers them implicitly.
- **Revocable.** Revocation takes effect on the next request; in-flight requests are
  cancelled, not completed.
- **No migration of private history.** Existing conversations remain `PRIVATE` with no
  grant. Enabling a mode on an old conversation is refused.

## Threat model

| # | Threat | Vector | Control | Residual |
|---|---|---|---|---|
| T1 | Sensitive history leaves the machine | Operator enables cloud, history contains RESTRICTED turns | Per-turn class + ceiling: any RESTRICTED turn forces local for that request; grant ceiling is `INTERNAL` | Operator authorises a provider that misbehaves |
| T2 | Silent widening after a setting change | Mode flips from PRIVATE to CLOUD_PERMITTED | Mode is per conversation and versioned; old turns keep their own class; grant records its creation instant | A future turn may legitimately include pre-grant *user* text above ceiling — refused instead |
| T3 | Provider substitution | Failover to another provider/model | Grant names provider and model; routing refuses to substitute | Misconfiguration inside the gateway registry |
| T4 | Tool results leak through a conversation grant | A capability returns RESTRICTED data mid-conversation | Tool results classified independently; request re-evaluates `maxPrivacyClass` after each result | A tool that mislabels its own output |
| T5 | Denial of service via fail-closed | Missing classification blocks the assistant | Fallback is local inference, which must exist for `PRIVATE` continuity anyway | No local model ⇒ no continuity (current state) |
| T6 | Replay of a revoked grant | Stale client presents an old grant id | Grants are server-side rows with `revoked_at`; client only names a mode, never a grant | Client can downgrade to PRIVATE at any time (safe) |
| T7 | Inference metadata leakage | Provider sees prompt structure even without content | Cloud mode sends only eligible turns; `analysisOnly` remains for remote agents | Provider logs are out of our control — document in the grant |

## Implementation (deferred, exact dependencies)

1. Migration `0019_conversation_privacy.sql`:
   `alter table experience.conversation_turns add column privacy_class text
    check (privacy_class in ('PUBLIC','INTERNAL','SENSITIVE','RESTRICTED'))`,
   `add column privacy_regime text not null default 'PRIVATE'`, and a
   `experience.conversation_privacy_grants(conversation_id, principal_id, provider, model,
    ceiling, granted_at, expires_at, revoked_at)` table. Existing rows are `PRIVATE` with
   `privacy_class` null, which the routing policy must treat as `RESTRICTED`.
2. `companion-service` writes `privacy_class = context.maxPrivacyClass` on completion.
3. `cognize` refuses `conversationId` + cloud unless a live grant exists whose ceiling
   covers every prior turn's class; otherwise it keeps today's local-forced behaviour.
4. Tests: T1–T6 above as adversarial cases, plus "no grant, no cloud" and "revoked grant".

None of this is started: it changes authority surfaces and the owner's rule is that
privacy behaviour must not be weakened to make a demo work.

## Consequences

- Today, cloud-backed conversation continuity is impossible **by design**, not by
  oversight. Continuity requires a local model (see `JARVIS-RESONANCE.md` §C).
- The assistant is fully usable for single-turn cloud conversation and for local
  multi-turn conversation, which is the honest state of the system.
