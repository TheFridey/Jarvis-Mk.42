# JARVIS · First Words — installation and the one blocker

Baseline `487b93b` → this pass. Mark 42 untouched at `9c1b880`, V2 untouched. No
microphone opened, no paid inference, no credential read.

## The short version

The engine and the model are installed on D: and the model is hash-verified against the
publisher. The official whisper.cpp Windows binary **cannot run on this machine**, and that
is now proven rather than assumed: it is an x86-64 PE, and on Windows ARM64 it exits
immediately during CPU feature detection before it even parses its arguments. A native
ARM64 build needs a compiler (clang-cl/CMake/Ninja), which the mission forbids installing
without your approval.

So the honest state: **everything except the compiler is in place.** One approval unblocks a
real, local, offline transcription test with the fixture I already generated.

## Classifications

| Workstream | Result | Basis |
|---|---|---|
| GATEWAY_READINESS | **BLOCKED_EXTERNAL** | Kernel healthy, but no Gateway process exists (`7430` closed, `model-gateway OFFLINE`). Your key is in your shell, not in a running process. |
| FIRST_TURN_INFERENCE / MULTI_TURN_INFERENCE | **BLOCKED_EXTERNAL** | No gateway ⇒ no provider. |
| ASR_EXECUTABLE | **BLOCKED_EXTERNAL** | Official v1.8.0 binary installed at `D:\AI\Runtimes\whisper\Release\main.exe`; **exits 1 with no output on ARM64** (x64-only, AVX). |
| ASR_MODEL | **VERIFIED_LIVE** | `ggml-base.en.bin`, 147,964,211 bytes, SHA-256 matches HuggingFace's published LFS OID exactly. |
| REAL_ASR_SYNTHETIC_AUDIO | **BLOCKED_EXTERNAL** | Cannot run the engine. Fixture audio is ready and waiting. |
| AUDIOFRAME_INGESTION | **NOT_ATTEMPTED** | Needs a capture source; capture is owned by the sidecar/Windows path. |
| TRANSCRIPT_CONVERSATION_INTEGRATION | **PARTIAL** | Existing `VoiceEngine` → Kernel `asr.final` path unchanged; not exercised. |
| RTC_CONFIGURATION | **NOT_RUN** | Generator exists and is tested; you haven't invoked it. |
| RTC_HEALTH | **BLOCKED_EXTERNAL** | `rtc OFFLINE` — no credentials in the Kernel's environment. |
| KOKORO_LOCAL_ASSETS | **NOT_ATTEMPTED** | Requires the asset set and an approved serving path. |
| REAL_SYNTHESIS | **PARTIAL** | System.Speech produced a real 16 kHz mono WAV (used as the ASR fixture). Kokoro not exercised. |
| PHYSICAL_MICROPHONE / PHYSICAL_TRANSCRIPTION / AUDIBLE_PLAYBACK / FULL_LOOP | **NOT_ATTEMPTED** | Yours to perform. |
| RESOURCE_QUALIFICATION | **PARTIAL** | Disk and RAM measured; no engine to measure. |

## A — Live runtime baseline, measured

```
kernel  http://127.0.0.1:7420  ok: true
        postgres HEALTHY · redis HEALTHY · event-bus HEALTHY · nats HEALTHY
        world-model HEALTHY · memory-subsystem HEALTHY
        model-gateway OFFLINE · rtc OFFLINE
gateway http://127.0.0.1:7430  not listening
export  http://127.0.0.1:4300  200
RAM     15,974 MB total · 1,513 MB available
C:      6.2 GB free · D: 660 GB free
```

**Your key has not reached any process.** The launcher only starts the Gateway when
`OPENROUTER_API_KEY` and `JARVIS_OPENROUTER_MODEL` are set *in the shell that runs it*, and a
Gateway started earlier would still hold the old environment. In your own PowerShell 5.1
window:

```powershell
# stop whatever is running, then start fresh so the new environment is applied
powershell -ExecutionPolicy Bypass -File D:\Projects\Jarvis-Sentience\scripts\jarvis-up.ps1 -Down

cd D:\Projects\Jarvis-Sentience
$secure = Read-Host -AsSecureString "JARVIS-RUNTIME key"
$env:OPENROUTER_API_KEY=[Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
$env:JARVIS_OPENROUTER_MODEL='deepseek/deepseek-v4.1-flash-1017'
$env:JARVIS_PREFERRED_MODELS=$env:JARVIS_OPENROUTER_MODEL
powershell -ExecutionPolicy Bypass -File scripts\jarvis-up.ps1
```

Then confirm — this is the only check that proves the key arrived, and it prints nothing
sensitive:

```powershell
Invoke-RestMethod http://127.0.0.1:7430/health
Invoke-RestMethod http://127.0.0.1:7420/diagnostics |
  Select-Object -Expand dependencies | Where-Object name -eq 'model-gateway'
```

Expected: gateway answers, and `model-gateway` becomes `HEALTHY`. If the launcher prints
`port 7420 is already in use`, that is the guard telling you a stale Kernel is holding the
old environment — `-Down` first.

## B — What was installed

| Item | Path | Detail |
|---|---|---|
| whisper.cpp binaries (official) | `D:\AI\Runtimes\whisper\Release\` | release **v1.8.0**, asset `whisper-bin-x64.zip`, 3,824,814 bytes, SHA-256 `b2ef45d9dae84df20437fd75346bd24e2f4ecc49f8292ca2545ab8890d342d89` |
| Model | `D:\AI\Models\SpeechRecognition\ggml-base.en.bin` | 147,964,211 bytes, SHA-256 `a03779c8…36c6d002` = publisher LFS OID |
| Download cache | `D:\AI\Cache\whisper\whisper-bin-x64-v1.8.0.zip` | kept for reproducibility |
| Scratch | `D:\JarvisData\Speech\tmp` | adapter temp WAV directory |
| Fixture | `D:\JarvisData\Speech\fixtures\spoken-check.wav` | 266,766 bytes, 16 kHz mono, synthetic System.Speech utterance — **no microphone involved** |

Licence: whisper.cpp is MIT; ggml models from `ggerganov/whisper.cpp` are MIT with the
OpenAI Whisper weights licence. Neither was committed to Git.

## C — Why the engine does not run here

```
> .\main.exe --help                      → prints help (works)
> .\main.exe -m <missing model> -f …     → exits 1, no message
> .\main.exe -m <real model> -f <wav>    → exits 1, no message

PE machine: 0x8664 (x86-64)      Host: ARMv8 (Snapdragon X Plus)
```

It never reaches argument validation, so the failure is in startup CPU dispatch: the x64
build uses AVX-family instructions that Windows' x64-on-ARM64 emulation does not provide.
The upstream project has acknowledged that official releases are x64-only and that a native
ARM64 build requires `clang-cl` (MSVC miscompiles ARM64 NEON intrinsics for this codebase).

What is *not* blocked: the adapter, its validation, its exit-code/timeout/cancel handling,
and the model. Only the executable is.

## D — The one decision I need from you

**Option 1 (recommended): approve a native ARM64 build toolchain.**
Installs LLVM/clang-cl + CMake + Ninja (WinGet or the VS Build Tools "C++ Clang" component),
then builds pinned tag `v1.8.0` natively with NEON:

```powershell
winget install --id Kitware.CMake -e
winget install --id Ninja-build.Ninja -e
winget install --id LLVM.LLVM -e
git clone --depth 1 --branch v1.8.0 https://github.com/ggml-org/whisper.cpp.git D:\AI\Runtimes\whisper-src
cmake -S D:\AI\Runtimes\whisper-src -B D:\AI\Runtimes\whisper-src\build -G Ninja `
  -DCMAKE_C_COMPILER=clang-cl -DCMAKE_CXX_COMPILER=clang-cl -DCMAKE_BUILD_TYPE=Release `
  -DGGML_NATIVE=ON -DGGML_SVE=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON
cmake --build D:\AI\Runtimes\whisper-src\build --config Release
```
Then set `JARVIS_ASR_EXECUTABLE` to the built `whisper-cli.exe`. Expected: base.en on a
Snapdragon X Plus should transcribe a 9-second clip in roughly 1–3 s with 3–4 threads; that
is an expectation, not a measurement, and it will be measured.

**Option 2: skip whisper, use Windows speech.** It works today and needs nothing, but
dictation quality is poor: on the very fixture above, System.Speech returned `Police` with
confidence `0.0024` for a clean 9-second en-GB utterance. I would not build the assistant's
voice on that.

**Option 3: nothing.** Text conversation remains the interface; voice stays unavailable.

## E — Fixture pipeline that is ready

The ASR qualification is one command away once an engine runs:

```
D:\JarvisData\Speech\fixtures\spoken-check.wav   (synthetic TTS, "Hello Jarvis. This is a
                                                  microphone check. The fictional project
                                                  codename is Aurora.")
   → whisper-cli -m ggml-base.en.bin -f … -l en -nt
   → expected transcript containing "microphone check" and "Aurora"
```

The adapter itself is already exercised end to end against fixture engines: 32 tests
covering timeout, cancellation, exit codes, temp cleanup, buffer bounds and hostile paths.

## F — What is still missing for a real voice turn

1. A working ARM64 recogniser (above).
2. A Node capture source producing `AudioFrame`s, **or** accepting that capture stays with
   `apps/voice` (System.Speech / sidecar) and the adapter is used for recorded utterances.
   I have not built a parallel microphone system: the existing capture owner is the
   sidecar/Windows path, and duplicating it would create two authorities over the mic.
3. `pnpm rtc:config` (yours), for the browser voice path.
4. Kokoro assets on D: and a local serving path — investigated, not implemented: the
   Transformers.js worker fetches `onnx-community/Kokoro-82M-v1.0-ONNX` weights from the hub
   and the browser caches them on C:, and moving that to D: needs a loopback asset server and
   an explicit local-model path in the worker. Doing it half-way would leave weights on C:
   and claim otherwise.

## G — Nothing here is a voice test

No microphone was opened, no recording was made, no transcript was produced from speech. The
fixture is machine-generated audio, and it has not been transcribed by anything yet — the
engine that would do it does not run on this machine.
