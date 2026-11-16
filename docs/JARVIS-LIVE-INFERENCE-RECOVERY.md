# JARVIS · Live inference recovery

Baseline `fd93d3a` → this pass. Mark 42 untouched. No paid request was made, no secret read,
no process restarted.

## 1 · Root cause, in one sentence

The companion service asked the grant policy a question that included **the turn currently
being processed** — a row inserted as `running` with `privacy_class = NULL` — so every first
cloud turn judged itself "unclassified history", refused its own grant, fell back to forced
local inference, found no local model, and returned `NO_ROUTE` (HTTP 503), which the desktop
then rendered as one generic sentence.

## 2 · Exact source

| Layer | Location |
|---|---|
| Decision | `apps/core/src/kernel/experience/companion-service.ts` → `grantDecision()` (history query) |
| Presentation | `apps/desktop/src/experience/scene-client.ts` → `command()`, which mapped **any** 503 on `/desktop/cognition` to one fixed sentence |

## 3 · Evidence chain (durable, from the live database)

The Kernel wrote nothing request-shaped to `.logs/kernel.log` because it was started from a
shell; the authoritative record is `cognition.runs`, which survived:

```
request_id  42e79ace-…   status failed   error_code NO_ROUTE   model_id (none)   privacy INTERNAL
```

and the Gateway's routing record for the same correlation id:

```json
{"phase":"CANDIDATE","privacyClass":"INTERNAL","candidates":[
  {"modelId":"deepseek/deepseek-v4.1-flash-1017","provider":"openrouter",
   "locality":"cloud-ok","healthState":"healthy","state":"UNAVAILABLE",
   "reason":"privacy/locality requires local execution"}]}
```

That reason is only produced when `locality === 'local'` or `cloudAllowed === false`. The
model was healthy; the **request was forbidden from using it**.

Then the decisive rows:

| Fact | Value |
|---|---|
| Cloud grant existed | `01M7AJEJKEMWJWNP9NQWBSCPSQ`, live, ceiling INTERNAL, policy v1 |
| Grant conversation | `053b2416-…` |
| Turn conversation | `053b2416-…` — **identical** |
| Principal (grant, turn, run) | `principal-operator` — identical |
| Grant created | 13:44:44 |
| Turn started | 13:45:00 |
| Turn row | `status = failed`, `privacy_class = NULL`, `privacy_regime = PRIVATE` |

Reproduced against the real policy with those values:

```
current turn included : {"allow":false,"reason":"unclassified_history"}
completed turns only  : {"allow":true,"grantId":"01M7AJEJKEMWJWNP9NQWBSCPSQ","provider":"openrouter"}
```

## 4 · Trace

| # | Stage | Result | Note |
|---|---|---|---|
| 1 | Desktop command received | PASSED | Turn row exists |
| 2 | Request admitted | PASSED | Authenticated `desktop.write` session |
| 3 | Principal resolved | PASSED | `principal-operator` |
| 4 | Conversation identity | PASSED | `053b2416-…`, same as the grant |
| 5 | Privacy regime | PASSED | PRIVATE at admission (no grant applied yet) |
| 6 | Cloud grant exists | PASSED | Live, ceiling INTERNAL |
| 7 | Grant ownership | PASSED | Same principal |
| 8 | Grant validity | PASSED | Not revoked, not expired, policy v1 |
| 9 | Provider binding | PASSED | openrouter |
| 10 | Turn classification | NOT_REACHED | Failed before completion |
| 11 | History selection | **FAILED** | Included the in-flight turn |
| 12 | Context compile | **FAILED** | Gateway record says INTERNAL; policy refused before it mattered |
| 13 | Required locality | **FAILED** | Forced `local` by the refusal |
| 14 | cloudAllowed | **FAILED** | `false` |
| 15–18 | Provider/model/eligibility | PASSED (as a *local* request) | One cloud model, healthy, rejected for locality |
| 19 | Dispatch-time grant check | NOT_REACHED | No dispatch |
| 20 | Gateway dispatch | NOT_REACHED | Registry rejected first |
| 21 | Provider invocation | NOT_REACHED | — |
| 22 | Response | FAILED | `NO_ROUTE` → 503 |
| 23–25 | Persistence / picture / UI | FAILED | Generic sentence shown |

First failing boundary: **11 — history selection inside the grant decision.**

## 5 · The 10.33 ms Gateway event

It was the registry evaluating a *routing* request and finding no eligible model. It never
called OpenRouter: no outbound provider request, no tokens, no cost. The absence of a
provider log line is correct for a request that was refused before dispatch.

## 6 · Fix

```sql
-- grantDecision()
where conversation_id = … and principal_id = …
  and status = 'completed'
  and turn_id <> $currentTurn
```

Only completed turns, never the one asking. A `running` turn has no classification yet, so
including it guarantees `unclassified_history` on the first turn of every cloud conversation.

Second change, same defect class: the desktop now reads the Kernel's `{code}` and renders an
actionable sentence per authoritative error (`NO_ROUTE`, `AUTHENTICATION`, `RATE_LIMITED`,
`TIMEOUT`, `UNAVAILABLE`, `BUDGET_EXCEEDED`, `PROVIDER_ERROR`, `INVALID_RESPONSE`,
`CANCELLED`). For this exact failure it says:

> *No model can serve this request: a private conversation needs a local model, and none is
> registered. Press ALLOW CLOUD to permit the configured provider, or configure a local
> model.*

Nothing about privacy ceilings, provider binding, revocation or dispatch-time checks was
relaxed.

## 7 · Tests

| Added | What it pins |
|---|---|
| `conversation-privacy.test.ts` (+2) | an unclassified turn refuses dispatch — the reason the asking turn must be excluded; completed turns remain eligible |
| `inference-errors.test.ts` (4) | each code yields distinct, actionable text; no credential/header leakage; unknown codes fall back safely |

Full run after the fix: see §9.

## 8 · Operator retry

**The Kernel must restart** (it is `tsx src/main.ts`, not a watcher, so it will not pick this
up). The Gateway runs `tsx watch` and reloads itself — no action needed there. Nothing needs
rebuilding: the export was rebuilt with the new error messages.

Run this **in the PowerShell window that holds your key** — starting it from anywhere else
loses the runtime key:

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

Then, in presence (<http://127.0.0.1:4300/?mode=presence>):

1. Set **Preferred inference model** to `deepseek/deepseek-v4.1-flash-1017` in the command
   centre (your existing grant records `gpt-6.1-sol`, the old UI default; it steers
   preference, and the only registered model is deepseek, so the turn will reach it — but
   matching them removes the ambiguity).
2. Press **ALLOW CLOUD** to create a fresh grant for a new conversation.
3. Send *"Hello Jarvis. Introduce yourself in one sentence."*

If it still refuses, the new message will name the reason instead of hiding it — send me that
sentence and the next step is one query, not a guess.

## 9 · Verification

Recorded in the commit: full unit suite across desktop/core/gateway/voice, monorepo
typecheck, lint, fitness, production export rebuild.

## 10 · Honest limits

The fix is proven at the decision boundary and in the durable record; the end-to-end paid
turn is **yours to run**. Until you see a provider-generated sentence, inference is still
unverified, and this document says so rather than implying otherwise.
