# JARVIS · Humanity — identity and conversational registers

Baseline `32d1445`. One identity, three registers, one authority boundary.

## What was actually wrong

The assistant had one style instruction, written for operational work: concise, calm, direct.
Every message — "Evening Jarvis", "Girls on Film!", "Just having a laugh" — reached the model
with that framing, so ordinary conversation arrived looking like an unclassified task. The
model had no guidance on being a companion, so it behaved like a system that had been handed
input it did not recognise.

## What changed

`apps/core/src/kernel/cognition/assistant-identity.ts`, `IDENTITY_VERSION = 2`:

- **identity** — British English, warm without sentimentality, direct without harshness,
  curious without interrogating, honest about uncertainty, humour permitted but never forced,
  length matched to the moment.
- **relationship** — the patterns you actually have: greetings are invitations to talk, no
  "sir", never "Awaiting your instructions", cultural references are conversation rather than
  a task, hype only when asked and grounded in real work, wins are allowed to stand, setbacks
  acknowledged without reassurance or armchair diagnosis, "business mode" shifts to practical
  focus, disagreement with reasons, family time not treated as spare capacity.
- **registers** — `COMPANION | ADVISOR | OPERATOR`, inferred from the message by
  `registerFor()`. You never pick a mode; you just speak, and change subject.

The register is chosen at the real production call site, not in a document:
`cognition-orchestrator.ts` passes `assistantConstraints(registerFor(req.input))`.

## What did not change

The authority contract is identical in all three registers — "you propose, the Kernel acts" —
and the tests assert it per register. Tone cannot become permission. Nothing in the profile
carries personal, business or credential context; `IDENTITY_FORBIDDEN_TERMS` and a names check
enforce that on every run.

## Register inference

| message | register | why |
|---|---|---|
| "Evening Jarvis." | COMPANION | default: nothing was asked |
| "Girls on Film!" | COMPANION | a reference is conversation |
| "We've landed another client!" | COMPANION | celebration held by a guard |
| "Business mode." | ADVISOR | explicit transition |
| "Do you think raising prices 30% is a good idea?" | ADVISOR | commercial judgement |
| "The migration keeps timing out." | ADVISOR | a problem to discuss, not an instruction |
| "Can you run the migration?" | OPERATOR | imperative |
| "Restart the production server." | OPERATOR | imperative |

The distinction that matters: **a noun is not an instruction.** Earlier drafts sent "the
migration keeps timing out" to OPERATOR because it contained "migration"; the rule now
requires an imperative form.

## Evidence

- `identity-registers.test.ts` — 30 assertions: versioning, no personal data or names,
  register inference across 15 real phrasings, authority contract per register, no
  operational framing in companion, no self-granted permission language.
- `evaluation-dataset.test.ts` — 60 behavioural cases across 21 categories, each stating
  expected *conduct* rather than an expected reply, and each agreeing with the running
  register heuristic.
- `source-hygiene.test.ts` — no control characters in any `.ts/.tsx/.json/.ps1`; this exists
  because a `\b` written as a literal backspace silently broke a regex twice in one session.

## Classifications

| | |
|---|---|
| CANONICAL_IDENTITY | **IMPLEMENTED_TESTED** (needs a Kernel restart to reach the model) |
| RELATIONSHIP_PROFILE | **IMPLEMENTED_TESTED** |
| CONVERSATIONAL_REGISTERS | **IMPLEMENTED_TESTED** |
| CASUAL_CONVERSATION_PATH | **PARTIAL** — the prompt now suits it; capability schemas and operational context are still assembled by the agent runtime and are not yet register-scoped |
| CULTURAL_REFERENCE_SUPPORT | **PARTIAL** — guidance present, model behaviour unmeasured |
| GENERAL_KNOWLEDGE_INTERACTION | **PARTIAL** — same reason |
| BEHAVIOURAL_EVALUATIONS | **PARTIAL** — 60 cases and rubric dimensions, zero scores (none can be honestly produced without a live model and a human reviewer) |
| PERSONAL_IMPORT_SCHEMA · MEMORY_* · CLOUD_MEMORY_PRIVACY · CONVERSATION_ARCHIVE_IMPORT · SECURITY_REGRESSION (memory) · LIVE_PERSONALITY_ACCEPTANCE | **NOT_ATTEMPTED** |

I stopped after the identity and register work rather than starting a memory schema I could
not finish honestly in this pass. `docs/architecture/JARVIS-IDENTITY.md` records the rubric
for scoring the 60 cases once you have a live model.

## Operator checkpoint

The Kernel must restart for the identity to take effect (it is not a watcher). Gateway
unchanged. Restart only from the shell holding your key:

```powershell
powershell -ExecutionPolicy Bypass -File D:\Projects\Jarvis-Sentience\scripts\jarvis-up.ps1 -Down
cd D:\Projects\Jarvis-Sentience
$secure = Read-Host -AsSecureString "JARVIS-RUNTIME key"
$env:OPENROUTER_API_KEY=[Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
$env:JARVIS_OPENROUTER_MODEL='deepseek/deepseek-v4.1-flash-1017'
$env:JARVIS_PREFERRED_MODELS=$env:JARVIS_OPENROUTER_MODEL
powershell -ExecutionPolicy Bypass -File scripts\jarvis-up.ps1
```

Then, in a fresh conversation:

1. "Evening Jarvis." — expect a greeting, not a prompt for instructions.
2. "Girls on Film!" — expect Duran Duran, not a request to clarify the operation.
3. "Just having a laugh." — expect company.
4. "Tell me something interesting about science." — expect curiosity, not a schema.
5. "Time for a hype session." — expect substance grounded in real work, no invented wins.
6. "Business mode." — expect focus, and pushback if you say something shaky.
7. "I think we should focus on the next engineering milestone." — expect a plan, not a recital.

Tell me which of those seven misses, and with what wording. That is the only evidence that
counts for tone; I will not claim the personality works because the prompt compiled.
