# JARVIS · Vocalis: Connection

Baseline `37d193a` → this pass. Mark 42 untouched, V2 untouched. No microphone opened, no
paid inference, no files moved outside the repository's own build.

## What is connected now

The gap was four components looking at each other. Three of the four are now wired:

```
presence "MIC" button  →  UtteranceRecorder (getUserMedia, 16 kHz, silence/20 s stop)
                       →  POST /voice/utterance   (authenticated desktop session, strong)
                       →  UtteranceService        (validates PCM/WAV, 30 s and 1.2 MB bounds)
                       →  WhisperCppAsrAdapter    (the installed ARM64 engine, base.en)
                       →  transcript              →  the command input
                       →  operator submits        →  existing cognition path, unchanged
```

The transcript lands in the input and **stops there**. Submission is a deliberate operator
action; a misheard sentence can never become an instruction.

## Classification

| Workstream | Result | Basis |
|---|---|---|
| BROWSER_CAPTURE | **IMPLEMENTED_TESTED** | `voice-capture.ts`: getUserMedia in a gesture, 16 kHz context, silence and 20 s stop, track/context release. Not exercised with a real microphone. |
| VOICE_ADMISSION | **PARTIAL** | Endpoint requires a strong, node-bound `desktop.write` session and derives the principal from it. A dedicated voice-session mint is not implemented. |
| AUDIO_INGESTION | **IMPLEMENTED_TESTED** | 16-bit mono → frames, RIFF sniffing, 30 s and 1.2 MB bounds, 413 on oversize. |
| REAL_ASR_INTEGRATION | **IMPLEMENTED_TESTED** | Same adapter and engine that transcribed the fixture at RTF 0.17; wired through `@jarvis/speech`. |
| TRANSCRIPT_DELIVERY | **IMPLEMENTED_TESTED** | Dictation fills the input and reports silence/permission/engine problems in place. |
| CONVERSATION_INTEGRATION | **VERIFIED_LIVE** (unchanged path) | Speech text is ordinary input; grants, ceilings and dispatch checks apply exactly as for typing. |
| LOCAL_TTS_INTEGRATION | **PARTIAL** | `POST /voice/speak` returns real System.Speech WAV (measured 63 ms for 5.42 s of speech). Browser playback is not wired yet. |
| BROWSER_PLAYBACK | **NOT_ATTEMPTED** | The response is not yet fetched and played. |
| KOKORO_LOCAL_ASSETS | **NOT_ATTEMPTED** | Unchanged: weights still hub-fetched. |
| SYNTHETIC_CONNECTED_PIPELINE | **PARTIAL** | Service-level tests cover audio in and audio out; a single test spanning capture → endpoint → engine → input has not been written. |
| PHYSICAL_* / AUDIBLE_RESPONSE / FULL_VOICE_CONVERSATION | **NOT_ATTEMPTED** | Yours to demonstrate. |

## Implementation

**`packages/speech`** — the ASR adapter and configuration moved out of `apps/voice` so the
Kernel can use them without importing another application. `apps/voice` now imports
`@jarvis/speech`; 47 tests moved with it and still pass.

**`apps/core/src/kernel/voice/utterance-service.ts`** — validates sample rate, channels, byte
width and length before touching the engine; sniffs RIFF rather than trusting a caller's
header; returns `{ok, transcript, problem, audioMs, latencyMs}` with problems named
(`empty`, `too_large`, `bad_rate`, `bad_channels`, `bad_sample_width`, `silence`,
`engine_unavailable`) so the interface can explain itself.

**`apps/core/src/kernel/voice/speech-synthesis.ts`** — local synthesis to WAV. Text goes in on
stdin as JSON; **only the output path is an argument**, so no caller string can reach a
command line. Bounded to 600 characters, 20 s timeout, temp file deleted in `finally`.

**Routes** — `POST /voice/utterance` (audio in, JSON out) and `POST /voice/speak` (text in,
`audio/wav` out), both behind a strong `desktop.write` session. No public listener, no
unauthenticated audio endpoint.

**Browser** — `voice-capture.ts` records with `AudioContext({sampleRate:16000})` through a
muted sink (so the microphone is never played back), stops on 900 ms of silence after speech
or at 20 s, releases the track and closes the context. `PresenceMode` gained one MIC control
that fills the input; `jarvis-experience` wires it through `transport.transcribeUtterance`.

## Verification

- 18 new tests: audio validation (rate, channels, width, size), silence reported as silence,
  missing engine, failure detail bounded, text cleaning, synthesis bounds.
- 576 passing in the affected workspaces, 2 skipped (real-engine tests, opt-in).
- Monorepo typecheck, lint clean, production export rebuilt.
- Browser acceptance 16/16 — the MIC control did not disturb the layout or interaction.

## Honest remaining work

1. **Playback.** `/voice/speak` produces real audio; nothing fetches and plays it yet. That is
   the next single change: on a completed response, POST the answer text, receive the WAV and
   play it through `AudioContext`, with SPEAKING driven by actual `playing` state.
2. **Voice session mint.** The endpoint authorises on the desktop session. A first-class
   `voice.write` session per utterance would be stricter and is the correct next hardening.
3. **A single end-to-end test** spanning capture shape → endpoint → real engine → input.
4. Kokoro assets.

## Operator checkpoint

The Kernel must restart to serve the new routes (it is not a watcher); the Gateway watches
its own sources and needs nothing. Restart **only** from the PowerShell window holding your
key:

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

Then: open presence, press **MIC**, allow the prompt, say *"Good evening Jarvis. Can you hear
me clearly?"*, wait for the input to fill, and submit it. You should see the recognised text
before anything is sent — that pause is intentional.

If the MIC button reports "Microphone permission denied" or "No speech detected", that is the
new error path working; tell me the sentence and I will calibrate the threshold rather than
guess.
