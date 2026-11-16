# RESONANCE III — checkpoint report

Baseline `a2d5aaf`. Owner selected `bm_george` as Jarvis's provisional voice.

## Delivered this checkpoint

| Item | Status |
|---|---|
| Bounded TTS performance investigation | **VERIFIED** — fp32 is 2× faster than q8 (RTF 1.05 vs 2.28) |
| Local synthesis service (warm, chunked, cancellable) | **VERIFIED** — real audio, real cancellation (1 chunk after abort at chunk 0) |
| Streaming endpoint `/voice/speak/stream` | **IMPLEMENTED**, contract tested; not exercised through a live Kernel in this pass |
| Presence playback (WebAudio queue, generation guard) | **IMPLEMENTED**, typecheck/lint clean; not yet heard through a browser |
| Manual interruption (STOP SPEAKING) | **IMPLEMENTED**; not yet exercised in a browser |
| Real audio level → `--voice-energy` | **IMPLEMENTED**; orb response UNVERIFIED |
| Automatic barge-in | **NOT IMPLEMENTED** |
| Transcript → conversation loop | **PARTIAL** — capture, VAD and transcription exist and are tested; automatic submission not wired |

## Measured

- Cold model load 28.5 s; warm RTF 0.94–1.05 (fp32); first chunk 4.5 s for a 9.4 s answer.
- Peak RSS ~541 MB. CPU only — no NPU, no GPU, none claimed.
- Chunking at 90 characters; cancellation verified.

## What the owner will experience

With `JARVIS_TTS_ENABLED` on, an answer can be spoken through the streaming endpoint, chunk one starting
while the rest synthesises, and STOP SPEAKING silences it immediately. Whether the current UI actually
invokes it depends on the speech toggle being on when the answer arrives.

## Not done

- The browser has not been driven through a speak cycle in this pass; playback is unproven in situ.
- The microphone loop is not automatic: capture and transcription work, submission is manual.
- Barge-in, orb reactivity and the redesigned MIC/VOICE controls remain open.

## Honest position

Jarvis can now synthesise his own answers locally, in the owner's chosen voice, with interruption that
works by construction. He cannot yet hold a spoken turn on his own: the microphone half of the loop is
still push-to-talk with manual submission. The next checkpoint is that join, not more synthesis work.


## Integration closure

### The verification gap, named

Root `tsconfig.json` includes `apps/*/src/**/*.ts` — **only `.ts`**. Every `.tsx` component in the desktop
app was therefore never typechecked by the workspace `tsc`, and lint does not resolve JSX types either. Two
errors that stopped the owner's production build (`setVoiceId` unused, `transport.speakStream` missing)
were invisible to both gates. The mandatory production build is now the gate that closes this, because it
is the only command that runs Next's own type validation over the actual app.

### Transport contract

`SceneTransport` now declares `speakStream?(text, {signal, voice})`, and `KernelSceneTransport` implements
it against `/voice/speak/stream` with session authentication. The interface treats the method as optional
and reports "voice unavailable" when a transport cannot speak — a synthetic or demo transport simply has no
synthesis endpoint. No casts, no `any`, no `@ts-ignore`: the previous `Partial<SpeechTransport>` assertion
was the bug.

### One synthesis implementation

The browser-side Kokoro worker (`neural-speech.ts`) and its voice picker were removed from the response
panel. Speech is produced by the Kernel's warm fp32 model and streamed to the browser, so the page no
longer downloads or runs a second neural model, and no reply text is synthesised by a competing engine.
`neural-speech.ts` itself remains in the tree with its test — it is unreferenced by the app — and can be
deleted once nothing else imports it.

### Effective voice configuration

`JARVIS_TTS_VOICE` sets the Kernel's voice; `bm_george` is the default, and the interface cycles
george → lewis → fable. `JARVIS_TTS_ENABLED=0` disables synthesis at the Kernel, so the stream endpoint
refuses and the interface reports unavailable rather than silently falling back. Voice **output** now
defaults on in the interface; the previous handover claimed that while the code had it off, which is
corrected here.

### Warm readiness

The Kernel warms the voice asynchronously at startup (`void kokoro.warm()`), deliberately not awaited, so
health and startup never block on 28 s of model loading. The first spoken answer therefore does not pay the
load cost; if the owner speaks before warming completes, the first chunk simply takes longer.

### Launcher transaction safety

`Save-Tracked` writes the PID file atomically (temp file + `Move-Item -Force`) immediately after **each**
launch, so a failure between Gateway and desktop leaves a recoverable record instead of untracked process
trees. `-RestartApp` stops only trees whose command line proves they belong to this repository.

### Production build

`pnpm --filter @jarvis/desktop build` → **exit 0**, static export completed, Next type validation passed.
The generated export carries only `http://127.0.0.1:7420` — the live Kernel — and no synthetic endpoint or
credential.
