# HANDOVER — final report

Baseline `f54a827` → this pass. Owner records, approvals, classifications and grants untouched.

## Browser journey — VERIFIED, 15/15, exit 0

`scripts/presence-browser-acceptance.ts` builds the real static export against an isolated kernel,
serves it, launches Chrome headless and drives the actual Presence interface over CDP: it types into
the real input, submits the real form, and waits for a rendered answer.

| check | result |
|---|---|
| real gateway and kernel ready | PASS |
| static export built against the isolated kernel | PASS |
| presence served, browser started, input rendered | PASS |
| cloud consent control used (real button) | PASS |
| browser request reached the provider | PASS — 16,128 bytes |
| multiple career sentinels in the payload | PASS |
| SENSITIVE, unconsented and cross-principal sentinels absent | PASS |
| answer rendered in the browser | PASS |
| interface left THINKING → STANDBY | PASS |
| general question sent, no personal memory block | PASS |
| second answer rendered | PASS |

Evidence: `browser-journey.json`, `browser-journey.png`.

Two defects in my own harness were found and fixed on the way, both worth recording because they
describe how the product behaves:

1. **Consent needs a conversation to attach to.** Clicking the consent chip before the first turn
   grants nothing, because no conversation exists yet; the first question then runs local and never
   reaches a provider. The harness now sends a warm-up greeting, then consents, then asks.
2. **A stale answer looks like a new one.** Waiting for text that merely contains the fixture answer
   matched the previous turn's rendered answer. The check now requires the text to change.

## Components

Real: Chrome, Presence static export, frontend API client, Kernel auth/grant/cognition, PostgreSQL
with real migrations, retrieval intent, ContextCompiler, AgentRuntime, Gateway, OpenAICompatibleAdapter.
Substituted: the provider (loopback fixture). Synthetic principal and records throughout.

## Disclosure metadata — PARTIAL

`ModelRequest.disclosure` is Kernel-set; the gateway refuses fallback when present. Absent means
unprotected, which is the documented contract but also a trust boundary: a caller holding the gateway
token could omit the marker and obtain fallback. Closing that requires requiring an explicit
classification on every request — a compatibility change across all callers, documented as the
migration path rather than taken unilaterally.

## Diagnostic privacy — VERIFIED

`redactFailure()` strips credential shapes then caps length; five tests. No new weakness found in the
cognition diagnostic path.

## ORACLE — VERIFIED as a presentation defect

See `oracle-queue.md`: 55 COMPLETE, 22 FAILED, zero waiting. The readout counts history.

## Verification

| Check | Result |
|---|---|
| Browser journey | **15/15, exit 0** |
| Convergence acceptance | 13/13, exit 0 |
| Full suite | see commit; typecheck, lint, fitness clean |

## Owner retest

```powershell
cd D:\Projects\Jarvis-Sentience
$pnpm = "C:\Users\rhysl\AppData\Local\node\corepack\v1\pnpm\9.15.9\bin\pnpm.cjs"
node $pnpm memory list     # expect 123 active, 92 cloud-authorised, 31 SENSITIVE
powershell -ExecutionPolicy Bypass -File scripts\jarvis-up.ps1 -Down
$secure = Read-Host -AsSecureString "JARVIS-RUNTIME key"
$env:OPENROUTER_API_KEY=[Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
$env:JARVIS_OPENROUTER_MODEL='deepseek/deepseek-v4.1-flash-1017'
$env:JARVIS_PREFERRED_MODELS=$env:JARVIS_OPENROUTER_MODEL
powershell -ExecutionPolicy Bypass -File scripts\jarvis-up.ps1
```

Then a fresh Presence conversation: "Afternoon mate!" · "Mate, tell me everything you know about my
previous career." · "What other work haven't you mentioned?" · "Right, business mode. What projects
are we currently working on?" · "How far have we come recently?" · "Give me a proper hype session,
mate. Go deep." · "What do you actually know about me?" · "What's the difference between ionic and
covalent bonds?"

Tracing: set `JARVIS_MEMORY_TRACE=1` before starting the Kernel; counts appear in
`.logs/kernel.err.log` and contain no statements.

## Remaining limitations

1. ORACLE projection not corrected.
2. Disclosure metadata default remains permissive for callers that omit it.
3. Browser suite covers two turns; follow-up expansion and the failure-state presentation are not
   driven yet.
4. Token ceilings remain estimates (4 bytes/token).
