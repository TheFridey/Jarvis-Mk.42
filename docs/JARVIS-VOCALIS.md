# JARVIS · Vocalis

Baseline `90721f2` → this pass. Mark 42 untouched, V2 untouched, no microphone opened, no
paid inference, no credential read.

## What this pass actually changed

Four things, each verified rather than asserted: the assistant's voice, the layout that was
overlapping, the browser gate that could have missed it, and the launcher's shutdown. The
voice *pipeline* (RTC surface → frames → ASR → transcript) is **not** connected yet, and this
document says so plainly instead of dressing interfaces up as integration.

## Classifications

| Workstream | Result | Basis |
|---|---|---|
| LIVE_TEXT_CONVERSATION | **OPERATOR_DEMONSTRATED** | Your two screenshots; preserved, not re-run. |
| MULTI_TURN_CONTINUITY | **OPERATOR_DEMONSTRATED** | Aurora recall, same conversation. |
| CONVERSATIONAL_IDENTITY | **IMPLEMENTED_TESTED** | New prompt layer; 7 tests. Takes effect on Kernel restart. |
| SENTIENCE_LAYOUT | **VERIFIED_LIVE** | No overlap measured in a real browser; 16/16 acceptance assertions. |
| PRODUCTION_BROWSER_REGRESSION | **VERIFIED_LIVE** | `scripts/browser-acceptance.mjs`. |
| LAUNCHER_PROCESS_LIFECYCLE | **IMPLEMENTED_TESTED** | Tree termination + port verification; not run against your live stack. |
| REAL_LOCAL_SYNTHESIS | **VERIFIED_LIVE (fallback path)** | System.Speech, en-GB, measured. Kokoro not installed. |
| KOKORO_LOCAL_ASSETS | **NOT_ATTEMPTED** | Asset set + worker change; see §5. |
| RTC_SURFACE_ADMISSION | **NOT_ATTEMPTED** | Precise blocker in §6. |
| LIVE_AUDIOFRAME_INGESTION | **NOT_ATTEMPTED** | Same blocker. |
| TRANSCRIPT_DELIVERY / PLAYBACK_LIFECYCLE / FEEDBACK_PREVENTION | **PARTIAL** | Existing engine paths unchanged, unexercised with speech. |
| REAL_ASR_ENGINE | **VERIFIED_LIVE** | From ARM64 Recovery: base.en, RTF 0.17. |
| RESTART_CONTINUITY / GRANT_REVOCATION | **NOT_ATTEMPTED** | Operator procedures in §7. |
| PHYSICAL_* / FULL_VOICE_CONVERSATION | **NOT_ATTEMPTED** | Yours. |

## 1 · The voice

Before, the model had one instruction: the JSON contract. So a safety rule ("never claim to
execute") was the only guidance it had for talking, and it produced:

> *"Noted: the fictional project codename is Aurora… I will not treat it as a real-world
> identifier… that would require a separate, Kernel-authorised action — I am only proposing
> this answer…"*

`apps/core/src/kernel/cognition/assistant-identity.ts` now separates the two concerns:
`identityConstraints()` sets voice (concise, direct, answer-first, no recital), `contractConstraints()`
keeps the JSON contract and the "propose, never claim" rule. The authority rule is unchanged —
it is simply no longer the whole personality.

Target register, encoded as rules rather than examples: *"Understood. Aurora it is."*, *"Aurora."*,
*"Good evening. How can I help?"*. Tests pin: name and concision present, recital forbidden,
execution claims still forbidden, JSON contract intact, no private/business/credential terms,
no conceal-failure instruction, and no interpolated state (identity must not vary by mode).

## 2 · The overlap

Two changes, layout rather than offsets:

1. `.presence-stack` is bottom-anchored and grows upward, so its top could cross into the
   two-line status band. `presenceZones()` now returns `stackMax` (viewport − detail band − 12)
   and the stack is capped with `max-height`, so the chip and the status cannot collide at any
   supported height.
2. The standby line for a recovered fault was long enough to need two lines. It now reads
   *"Standing by. Recovered at 21:07."* — the full record stays in the accessible label and in
   diagnostics, and no active or unresolved fault is hidden.

Measured in the live export: `stackTop 684 > detailBottom 659`, `detailVsChip false`,
`detailVsInput false`, chip and input both hit-testable.

## 3 · The browser gate

`scripts/browser-acceptance.mjs` drives system Chrome against the running export and fails
the process on: overlay not fixed, controls not visible, input not receiving pointer events,
privacy chip not clickable, status/chip overlap, historical answer present on open, `C` not
entering the command centre, `P` not restoring the interface, or the overlay losing its
positioning after a round trip.

Current run: **16/16 pass**. This is the check that would have caught the stylesheet
truncation before you saw it.

## 4 · The launcher

`-Down` killed the pnpm wrapper and left the `tsx` child listening — which is why you kept
finding live ports after a "successful" shutdown. It now resolves the owned process tree
(children first, never this script), and then **verifies** ports 7420/7430/4300 are actually
released, reporting failure instead of claiming success. Unrecognised port owners are named,
not killed.

Not exercised against your running stack — stopping it would have taken your configured
runtime down. It takes effect on your next `-Down`.

## 5 · Synthesis: what is real today

Qualified on the fallback path (offline, no download), sentence *"Good evening. All systems
are online and ready to assist."*:

| Measurement | Value |
|---|---|
| Engine | System.Speech, `Microsoft Hazel Desktop` (en-GB, female) |
| Output | `D:\JarvisData\Speech\fixtures\vocalis-preview.wav` — 16 kHz, mono, 16-bit |
| Duration | 5.42 s |
| Synthesis time | **63 ms** (≈86× realtime) |

**No British male voice exists on this machine through System.Speech** — only Hazel (en-GB,
female) and Zira (en-US, female). The en-GB male OneCore voice (`MSTTS_V110_enGB_GeorgeM`)
is present in the registry but is not exposed to System.Speech; it needs the WinRT
`Windows.Media.SpeechSynthesis` API. Kokoro would give a better voice but its weights are
still hub-fetched into the browser cache on C:.

Nothing was played through your speakers.

## 6 · The real remaining blocker for voice

The browser voice path needs three things that do not exist yet, in this order:

1. **Surface admission.** The Kernel's `/rtc/join` requires a node with `voice.write`, trust
   tier `kernel-local`/`owned-secure`, and a strong session. The browser surface registers as
   `local-server`; the voice worker that would consume the LiveKit track does not exist on the
   web side (Capture → `AudioFrame` is only implemented for files, via `decodeWav`).
2. **A capture owner.** Today capture belongs to `apps/voice` (System.Speech streaming or the
   Python sidecar). Adding a second capture path in the browser is precisely the "parallel
   microphone authority" the brief forbids without justification — and the browser path is the
   one that reaches SENTIENCE's microphone control.
3. **Kokoro assets.** `D:\AI\Models\SpeechSynthesis\Kokoro` is empty; the worker fetches from
   the Hub into the browser cache. A local asset path plus a loopback asset route is a small,
   well-defined change, but it is not started.

So: the recogniser runs, the model talks, the interface is whole — the wire between the
microphone button and the recogniser is the piece that is still missing.

## 7 · Operator procedures

**Restart to pick up the voice change** (Kernel only — the Gateway watches its own sources):

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

**Restart continuity** (unproven): after a restart, open presence, do **not** press ALLOW
CLOUD, and ask *"What was the fictional project codename?"* in the same conversation. A
correct "Aurora" with the original grant still live is the evidence. A refusal is also
evidence — send me the sentence.

**Revocation** (unproven live): press **MAKE PRIVATE**, then ask anything. The turn must be
refused cloud and either run locally or fail with the privacy/locality message. `cognition.runs`
should show `privacy_class` and no `model_id`.

## 8 · Verification

627→634 tests across desktop/core/gateway/voice · monorepo typecheck · lint clean · fitness
17/17 · production export rebuilt · browser acceptance 16/16 · no paid inference.

## 9 · Honest summary

You now have a conversational JARVIS with a better voice, an interface that is measurably
usable, a browser gate that protects it, and a launcher that can actually stop what it started.
You do not yet have a voice interface: the microphone button, the recorder, the recogniser and
the speaker are four components looking at each other across a gap nobody has wired.
