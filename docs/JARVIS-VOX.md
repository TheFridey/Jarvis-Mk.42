# JARVIS · Vox — local speech recognition

Baseline `3164802` → this pass. Mark 42 untouched at `9c1b880`; V2 untouched. No model
downloaded, no microphone opened, no paid inference.

## The finding that matters

The repository already contains a local speech path — and it cannot install on this machine.

`apps/voice/sidecar/requirements.txt` pins **faster-whisper 1.1.1**, which runs on
CTranslate2. Verified against PyPI metadata for ctranslate2 4.9.0: the published wheels are
`macosx_*_arm64`, `macosx_*_x86_64`, `manylinux_*_aarch64`, `manylinux_*_x86_64` and
`win_amd64`. **There is no `win_arm64` wheel.** On a Snapdragon X Plus running Windows
ARM64, `pip install -r requirements.txt` cannot succeed, which is why the local sidecar was
never usable here — not a missing config file, a missing platform build.

What does work today, with zero downloads:

- `JARVIS_VOICE_ADAPTER=windows` → `WindowsSpeechInput`, a native **System.Speech**
  recogniser driven through PowerShell (`apps/voice/scripts/windows-speech.ps1`). On this
  machine the en-GB engine is present (`MSTTS_V110_enGB_George/Hazel/Susan` under
  `Speech_OneCore`), so British English recognition is available offline.
- Kokoro TTS in the browser (`kokoro-js`), 13 voices, model fetched by the worker — see §G.

## Classifications

| Workstream | Result | Basis |
|---|---|---|
| ASR_ENGINE_SELECTION | **VERIFIED** | CTranslate2 ARM64 wheel absence proven against PyPI; whisper.cpp ARM64 build path documented from upstream issues. |
| ASR_ADAPTER_IMPLEMENTATION | **IMPLEMENTED_TESTED** | 32 tests, fixture engine, no real transcription claimed. |
| ASR_MODEL_AVAILABILITY | **BLOCKED_EXTERNAL** | No engine binary, no model on disk. Nothing downloaded. |
| LOCAL_AUDIO_PROCESSING | **IMPLEMENTED_TESTED** | WAV encoding, bounds, sample validation, temp cleanup. |
| TRANSCRIPT_DELIVERY | **PARTIAL** | Existing `VoiceEngine` path handles `final` → Kernel `asr.final`; the new adapter is not yet wired to a capture source. |
| CONVERSATION_INTEGRATION | **PARTIAL** | Voice text obeys the same Kernel path and privacy policy; unexercised live. |
| SPEECH_PRIVACY | **IMPLEMENTED_TESTED** | No shell, argv-only, allowlisted env, bounded buffers, temp audio removed. |
| RTC_CONFIGURATION | **IMPLEMENTED_TESTED** | Generator from GENESIS LIVE, revalidated. |
| PHYSICAL_MICROPHONE | **NOT_ATTEMPTED** | Requires your gesture. |
| LIVE_SPEECH_RECOGNITION | **BLOCKED_EXTERNAL** | No engine/model. |
| TTS_AVAILABILITY | **PARTIAL** | Kokoro in-browser + System.Speech en-GB voices present; neither exercised with playback. |
| LIVE_SPEECH_PLAYBACK | **NOT_ATTEMPTED** | — |
| AUDIO_REACTIVE_ORB | **IMPLEMENTED_TESTED** | Orb follows observed `voiceAudio` only; never exercised with real audio. |
| FULL_VOICE_CONVERSATIONAL_LOOP | **NOT_ATTEMPTED** | — |
| RESOURCE_QUALIFICATION | **BLOCKED_EXTERNAL** | Nothing to measure without an engine/model. |

## A — The pipeline as it actually is

```
presence (browser)                         voice process (apps/voice)
  mic button ── getUserMedia ── LiveKit ──▶ SpeechInput
     (use-rtc-session)                        ├─ WindowsSpeechInput  (System.Speech, PowerShell, offline, streaming)
                                              └─ LocalVoiceSidecar   (Python: faster-whisper + silero-vad + kokoro)
                                                    ▲ not installable on win-arm64
                                                        │
                            RecognitionEvent (partial/final/silence/device-*)
                                                        ▼
                                              VoiceEngine  ── asr.final ──▶ Kernel /voice/events
                                                        │                      (voice-gateway → cognition)
                                                        ▼
                                              SpeechOutput (WindowsSpeechOutput | sidecar kokoro)
                                                        │
                                                    playbackAmplitude ──▶ Kernel voiceAudio ──▶ orb
```

Genuine implementations: `VoiceEngine`, `WindowsSpeechInput`, `WindowsSpeechOutput`,
`LocalVoiceSidecar`, echo guard, qualification, RTC session handling, Kernel voice gateway.
Interfaces without an implementation: `AsrAdapter`, `WakeWordAdapter`, `VadAdapter`,
`TtsAdapter`, `PlaybackAdapter`, `AudioDeviceManager` (the sidecar implements the last one
only when Python is installed).

**Where ASR belongs:** inside `SpeechInput` (the process that owns capture). The frame-based
`AsrAdapter` is the right shape for a *file/utterance* recogniser — which is what
whisper.cpp is — so this milestone implements that boundary and documents the bridge that
is still missing: a Node capture source that produces `AudioFrame`s.

## B — Engine selection

| Candidate | Verdict | Why |
|---|---|---|
| faster-whisper (in repo) | **Rejected** | No `win_arm64` CTranslate2 wheel (verified). Cannot install. |
| **whisper.cpp** | **Selected** | Plain C/C++, builds for Windows ARM64 with `clang-cl` (MSVC has a known NEON intrinsic bug; upstream recommends clang-cl). GGML models are small and CPU-friendly. Batch, not streaming. |
| Vosk | Fallback candidate | Small models, streaming, but no verified Windows ARM64 wheel; unproven on this host. |
| ONNX Runtime speech | Rejected for now | ORT ships win-arm64, but the Whisper ONNX export doubles model size and adds a runtime to supervise for no accuracy gain at this scale. |
| Browser `SpeechRecognition` | **Rejected** | In Chrome/Edge this is a cloud service. It would silently send audio off-machine, which the owner's rules forbid. |
| Windows System.Speech | **Accepted as the zero-install path** | Already implemented, fully offline, en-GB engine present. Quality is below Whisper; it is the working baseline, not the target. |

Adreno X1-45: **no GPU acceleration claimed.** whisper.cpp has Vulkan/NPU backends, but
nothing here verified them on this device, and a benchmark that contradicts itself is worse
than no benchmark.

## C — Implementation

`apps/voice/src/asr/whisper-cpp-adapter.ts` — `WhisperCppAsrAdapter implements AsrAdapter`:

- `inspectAsrConfig()` → `{ready, problem, detail}` with distinct reasons:
  `engine-missing`, `engine-not-executable`, `model-missing`, `temp-dir-missing`,
  `bad-config`. The UI can therefore say *why*.
- `encodeWav()` — validates 16 kHz mono float32, rejects non-finite samples, clamps rather
  than wrapping, bounds the utterance at 30 s and throws before allocating.
- `transcribe(frames, final, signal)` — `final: false` returns `''` (whisper.cpp is not
  streaming; an invented partial would be a lie). Runs `whisper-cli -m … -f … -l … -t … -nt -np`
  with `shell: false`, a curated environment, stdout capped at 64 KiB, a hard timeout, and
  `SIGTERM` on abort.
- Temporary WAV: created with `mkdtemp` inside a configured directory (default
  `D:\JarvisData\Speech\tmp`), mode 0600, removed in `finally`. Raw audio never reaches a log.
- `cleanTranscript()` — strips `[00:00:00.000 --> …]` prefixes, `[BLANK_AUDIO]`, `(music)`
  style annotations, collapses whitespace, caps at 4096 characters.

`apps/voice/src/asr/env.ts` — `resolveAsrConfig()` maps
`JARVIS_ASR_ENGINE` (`whisper-cpp | windows | none`), `JARVIS_ASR_EXECUTABLE`,
`JARVIS_ASR_MODEL_PATH`, `JARVIS_ASR_TEMP_DIR`, `JARVIS_ASR_LANGUAGE`, `JARVIS_ASR_THREADS`,
`JARVIS_ASR_TIMEOUT_MS`. Defaults are on D:. `apps/voice/src/main.ts` logs
`asr.ready engine=…` or `asr.unavailable engine=… problem=… detail=…` at startup, so the
operator sees the precise reason.

## D — Tests (32)

Configuration: missing engine, missing model, non-`.bin` model, missing scratch dir,
incomplete config, ready. Audio: WAV header, wrong sample rate, non-finite samples, 30 s
bound, clamping. Cleaning: timestamps, silence markers, length cap. Runtime: partial yields
nothing, success, non-zero exit with stderr, timeout, cancellation, abort-before-start,
temp cleanup after success, no scratch left after a config failure, **argv-only path
passing** (a path containing shell metacharacters arrives as one argument), stdout bound.

Fixtures are node scripts standing in for the engine. **No test claims real transcription.**

## E — Installing the engine and model (yours to run)

```powershell
# 1. Build whisper.cpp natively for ARM64 (clang-cl required; MSVC fails on NEON intrinsics)
git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git D:\AI\Runtimes\whisper-src
cmake -S D:\AI\Runtimes\whisper-src -B D:\AI\Runtimes\whisper-src\build -G Ninja `
  -DCMAKE_C_COMPILER=clang-cl -DCMAKE_CXX_COMPILER=clang-cl `
  -DCMAKE_BUILD_TYPE=Release -DGGML_NATIVE=ON -DGGML_SVE=OFF `
  -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON
cmake --build D:\AI\Runtimes\whisper-src\build --config Release

# 2. Model (English, ~466 MB for small.en; tiny.en ~75 MB, base.en ~142 MB)
New-Item -ItemType Directory -Force D:\AI\Models\SpeechRecognition | Out-Null
# ggml models: https://huggingface.co/ggerganov/whisper.cpp (mirror of upstream GGML weights)
# Verify the size and, where published, the SHA256 before trusting the file.

# 3. Configure and check
$env:JARVIS_ASR_ENGINE='whisper-cpp'
$env:JARVIS_ASR_EXECUTABLE='D:\AI\Runtimes\whisper-src\build\bin\Release\whisper-cli.exe'
$env:JARVIS_ASR_MODEL_PATH='D:\AI\Models\SpeechRecognition\ggml-small.en.bin'
$env:JARVIS_ASR_TEMP_DIR='D:\JarvisData\Speech\tmp'
```

Sizes are the upstream GGML figures (tiny.en 75 MiB, base.en 142 MiB, small.en 466 MiB);
RAM at runtime is roughly model size + ~200–400 MB working set for CPU int8 decoding, which
on a 16 GB machine with under 2 GB free is the binding constraint, not disk. Start with
`tiny.en` or `base.en`; `small.en` will page.

No download was performed and none is claimed to work until you run it.

## F — Privacy

| Threat | Control |
|---|---|
| Mic without a gesture | Capture starts only on an explicit activation event; the desktop path requires `getUserMedia` inside a click. |
| Audio leaving the machine | No external speech API exists in the code; the browser `SpeechRecognition` API is deliberately not used. |
| Shell injection via config | `spawn(executable, args, {shell:false})`; only validated paths and a fixed flag set. Tested with a hostile path. |
| Unbounded buffering | 30 s utterance cap, 64 KiB stdout cap, 2048-char stderr cap, hard timeout. |
| Raw audio retention | Temporary WAV only, 0600, in a configured directory, deleted in `finally`; never logged, never committed. |
| Cross-session transcript leakage | Unchanged: turns are bound to principal + conversation through the existing Kernel path; the grant policy still applies to any cloud turn. |
| Transcript as trusted instruction | Unchanged: transcripts enter as conversation input, subject to the same authority, approval and privacy rules as typing. A microphone does not grant tools. |
| Self-transcription loop | Existing echo guard + `tts` state; the engine ignores text while speaking unless barge-in is observed. |

## G — Kokoro, verified

- Inference is **in the browser**: `kokoro-js` `KokoroTTS` inside
  `neural-speech.worker.ts`, and the build aliases `@huggingface/transformers` to its web
  build. No server inference.
- **Weights are fetched by the worker on first use** (HF hub). That is a download to the
  browser cache on C:, not to `D:\AI\Models`. If you want speech fully offline, the worker
  needs a local weight path — not implemented, and it is the reason "TTS available" is
  classified PARTIAL rather than VERIFIED.
- 13 voice identifiers are enumerated in `neural-voices.ts`; British English voices are
  among them. Voice selection and preview are existing UI.
- Envelope: playback amplitude is measured by the player and published as `voiceAudio`;
  the orb only reacts to that.

Alternative already present: `WindowsSpeechOutput` (System.Speech) with the en-GB voices
found on this machine — offline, no download, more robotic than Kokoro.

## H — Operator sequence for the first physical conversation

1. `powershell -ExecutionPolicy Bypass -File scripts\jarvis-up.ps1` (Kernel + export + data plane).
2. Optional voice process: `node <pinned pnpm> --filter @jarvis/voice dev` and watch for
   `asr.ready` or `asr.unavailable problem=…`.
3. Open <http://127.0.0.1:4300/?mode=presence>, press the microphone, allow the prompt.
4. Say "Jarvis, this is a microphone check." Watch: LISTENING → transcript → THINKING →
   Speaking only during playback.
5. Press stop; the browser indicator must clear.
6. For a cloud answer, first press `ALLOW CLOUD` — speech does not grant cloud by itself.

Not performed here; nothing above is claimed to work until you see it.

## I — Remaining blockers

1. **whisper.cpp build + model** (or accept System.Speech quality) — the primary gap.
2. **Node capture source** producing `AudioFrame`s if the frame-based adapter is to be used
   in-process; otherwise the sidecar/windows path stays the capture owner.
3. Kokoro offline weights if TTS must run without the hub.
4. RTC (`pnpm rtc:config`) for the browser voice path.
5. OpenRouter key for the conversational half.
