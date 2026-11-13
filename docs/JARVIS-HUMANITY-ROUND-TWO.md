# JARVIS · Humanity, round two — memory slice and tone correction

From `b8e4239`. Two things, in the order you asked for: durable memory first, then the tone
corrections your seven tests exposed.

## 1 · Tone, from your observations

`IDENTITY_VERSION` stays 2; the wording changed:

| your finding | the instruction now |
|---|---|
| excessively deliberate British sophistication | "Write natural, modern British English — how people actually type. Do not perform sophistication: no ornate phrasing, no elaborate metaphors, no mock-formality." |
| over-explaining references | "Understanding is not explaining… react — do not deliver its history unless he asks. Do not turn humour into trivia." |
| flat emotional register | "Match the energy you are given. Excitement gets enthusiasm, not analysis… Do not hold one tone for the whole conversation." |
| same length everywhere | "Be concise by default: two sentences is usually enough. Match the length to the moment." |
| forced "mate"/slang | "Do not force 'mate' or slang into every reply, and never into technical or professional ones. It is not a costume." |
| hype lacked the wider journey | "That is a reflection on his actual journey — what he has built, survived and is aiming at — not encouragement about the last message." |
| repetition after "business mode" | "Treat it as opening a work session, not as an instruction to repeat the advice you just gave." |
| everything becomes a lesson | "Do not end every reply with a question, a lesson, or a push toward work." |

Prompt text cannot be verified by compilation, so this is **IMPLEMENTED_TESTED** and nothing
more until round two. The seven cases are recorded in `docs/evaluation/round-one-observations.json`
with your verdicts as they stand, not converted into invented scores.

## 2 · Memory vertical slice

The reason hype sessions had no depth is that there was nowhere for depth to come from: no
durable personal memory existed. Now the smallest complete slice does.

**Schema** — migration `0020_personal_memories.sql`, applied to the dev database (`Applied 1
migration(s)`, 16 columns, 0 rows — nothing backfilled):

- `review_status` (`pending | approved | rejected`), default **pending**
- `privacy_class` (`PUBLIC | INTERNAL | SENSITIVE | RESTRICTED`), default **SENSITIVE**
- `cloud_eligible`, default **false**
- `revoked_at` + `revoked_reason` — a tombstone, because "stopped using it" and "it never
  existed" are different claims
- `superseded_by`, `confidence`, `source`, `recorded_at`, `last_verified_at`, `policy_version`
- constraints on status, class, confidence, and on revocation requiring a reason
- a partial unique index so one subject has one live statement

**Selection** — `personal-memory.ts`, pure and inspectable:

- lexical relevance with a subject weighting and query-normalised scoring, so a long record
  cannot out-rank a precise one;
- refused in this order: wrong principal → revoked → superseded → rejected → unapproved →
  cloud-ineligible → irrelevant → budget;
- cloud ceiling is `INTERNAL`, matching conversations: SENSITIVE and RESTRICTED never leave,
  even if someone flags them eligible;
- `MEMORY_CONTEXT_LIMIT = 6`, and the model sees `- subject: statement` with no ids or
  provenance.

**Storage** — `personal-memory-store.ts`: `propose`, `approve`, `reject`, `correct`
(supersede, never overwrite), `revoke`, `loadForSelection`, `listForReview`, `exportApproved`.
A model can propose; only an approval makes a record usable.

**Evidence:** 18 tests on the policy — private stays local, revoked and superseded disappear,
another principal's memory is invisible even on a perfect match, a greeting drags nothing in,
budget overflow is reported rather than silently dropped, ties break on confidence.

## Classifications

| | |
|---|---|
| MEMORY_CANDIDATES | **IMPLEMENTED_TESTED** (propose + pending default) |
| MEMORY_APPROVAL | **IMPLEMENTED_TESTED** |
| MEMORY_PERSISTENCE | **PARTIAL** — schema applied to the dev database, zero rows: the store has not yet written a real record through the running Kernel |
| MEMORY_RETRIEVAL | **IMPLEMENTED_TESTED** — selection policy and relevance; not yet called from the live conversation path |
| MEMORY_CORRECTION / MEMORY_DELETION | **IMPLEMENTED_TESTED** (supersede and tombstone) |
| MEMORY_RESTART_CONTINUITY | **NOT_ATTEMPTED** |
| CLOUD_MEMORY_PRIVACY | **IMPLEMENTED_TESTED** — enforced in selection, not yet wired to dispatch |
| PERSONAL_IMPORT_SCHEMA / STAGING / ARCHIVE_IMPORT / REVIEW SURFACE | **NOT_ATTEMPTED** |
| CANONICAL_IDENTITY (round-two tone) | **IMPLEMENTED_TESTED** |

I did not wire memory into the live conversation path in this pass, and I will not describe it
as working personal memory until a real approved record survives a restart and comes back in
answer to the right question. That is the next change, and it needs one thing from you: a first
memory to approve.

## Operator checkpoint

Kernel restart needed for the tone change (identity is read at startup). Migration already
applied — it is additive and does not touch existing conversation tables.

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

Then repeat the two that mattered most — "Girls on Film! 😂" and "Time for a hype session." —
and tell me whether the reply got shorter and warmer respectively.
