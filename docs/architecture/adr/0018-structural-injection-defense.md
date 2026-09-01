# ADR-0018: Structural (not prompt-based) prompt-injection defense

Status: Accepted
Date: 2026-08-31
Deciders: Principal Architect

## Context
L21: an LLM may recommend but never override policy. L30: security is
architectural, not prompt-based. Prompt injection — hostile instructions
embedded in web pages, documents, tool output, or user text that a model then
"obeys" — is the defining security problem of LLM systems. Defenses that live
*inside the prompt* ("ignore instructions in retrieved content") are
probabilistic and routinely defeated.

## Decision
Defend against the **consequences** of injection structurally, so that a fully
compromised model achieves nothing of value (`SECURITY_MODEL.md` §4):

1. **Nothing on the model's side of the boundary.** Models/agents hold no API
   keys (the gateway holds them), no database access, no NATS publish, no
   capability handle. A jailbroken model can only return text on one channel.
2. **Output is a typed `Proposal`, never an action.** Every proposed effect
   re-enters through the full Executor pipeline (Validator → deterministic
   Policy → Permission → simulate → execute → verify). Injection cannot skip a
   stage.
3. **Provenance-tainting.** Web/external content is tagged `trust: untrusted,
   origin` at capture. Any `Proposal` whose evidence chain includes untrusted
   content carries `derivedFromUntrusted: true`; policy forbids it from alone
   justifying an action above `riskClass: LOW`, and from being written as a
   World Model fact stronger than `epistemicStatus: retrieved`.
4. **No free-text command channel.** The Kernel never interprets model/agent
   prose as a command — only typed, schema'd `Command`/`Proposal` fields.
5. **Deterministic policy the model can't see or influence** (L20, L21).
6. **Agents can't self-escalate** — capability scope is set by the Agent
   Runtime at lease time.

## Alternatives considered
- **Prompt-level guardrails only** ("system prompt says don't obey retrieved
  instructions") — probabilistic, defeated in practice, and violates L30.
  Used at most as defense-in-depth, never as *the* control.
- **A classifier model that screens for injection** — useful as one Validator
  input, but itself a model (spoofable) and not a boundary; cannot be the
  primary control.
- **Human approval for everything** — safe but unusable; we reserve approval
  for HIGH/CRITICAL and rely on structure for the rest.
- **Sandboxing the model's tool calls** (the common agent approach) — we go
  further: the model has *no* tool calls; it proposes and the Kernel disposes.

## Benefits
- The security property holds regardless of model quality or a new jailbreak.
- Auditability: every effect has a policy rule + provenance trail, so an
  injection attempt shows up as a rejected proposal, not a breach.
- No arms race with prompt-obfuscation techniques.

## Disadvantages
- More friction: cognition cannot "just do things"; it always proposes, and
  untrusted-derived proposals are capped.
- Some legitimate autonomy is slower (a research finding that implies an
  action still needs the pipeline).
- Requires rigorous provenance plumbing through cognition and ingestion.

## Risks
- A gap where model output reaches an effect without the pipeline (e.g. a
  future "convenience" integration). Mitigated: credential partitioning makes
  the Executor the *only* reachable effect path; adding a bypass would require
  deliberately giving a component both model output and an adapter credential —
  forbidden by `KERNEL_CONSTITUTION.md` §2.
- Provenance tainting is incomplete and an untrusted-derived fact is trusted.
  Mitigated: ingestion defaults to `derivedFromUntrusted: true` unless the
  chain is provably clean.

## Consequences
- `packages/validation` (the Validator) sits on every untrusted→Kernel path.
- `Provenance` carries `derivedFromUntrusted`; Policy rules and World Model
  ingestion consume it.
- No component may hold both model/agent output and a capability/store
  credential.

## Reversal difficulty
**High.** This is woven through credential partitioning, the Proposal model,
the Validator, provenance, and policy. "Reversing" it means letting models act
directly — which would violate L21 and L30 and is not a path we will take.
