# JARVIS · First Words

Baseline `0d9dfba` → this pass. Mark 42 untouched at `9c1b880`, V2 untouched. No microphone
opened, no paid inference, no credential read.

## Result: the machine now transcribes speech, natively

Upstream shipped Windows ARM64 builds in v1.9.4+ (the release asset list is on the nightly
tag that v1.9.5 links to, not on the stable tag itself). Installed
`whisper-bin-win-cpu-arm64.zip` from tag **b5454**: every binary and DLL reports PE machine
`0xAA64`, i.e. native ARM64, not emulation.

Real transcription through the real engine, on a synthetic 8.34 s fixture:

```
"Hello Jarvis. This is a microphone check. The fictional project code name is Aurora."
fixture text: "…the fictional project codename is Aurora."      (only "code name" vs "codename")
elapsed 1.44–1.46 s        RTF 0.17 (≈5.9x realtime)
peak working set 296 MB    exit 0    model 141 MiB on disk
```

Silence previously produced the classic Whisper hallucination ("you"). The adapter now gates
on RMS (−48 dBFS): a quiet utterance returns `''` and spends no CPU rather than inventing a
command.

## Also fixed: RTC was never actually constructible

Two defects, both mine, both now proven by a live `rtc HEALTHY`:

1. `JARVIS_RTC_ENABLED=1` is required for the Kernel to construct the RTC service at all —
   undocumented in my earlier runbooks, so `rtc` stayed `OFFLINE` with valid credentials in
   the environment. The launcher now sets it when `livekit.env` exists.
2. The generated `livekit.yaml` bound `127.0.0.1` **inside the container**, where the
   published port forwards to `eth0` and finds nothing. It now binds `0.0.0.0` in-container;
   host exposure stays loopback-only because `rtc.compose.yml` publishes `127.0.0.1:7880`.
   Verified: `POST /twirp/livekit.RoomService/ListRooms` → `401` (reachable, unauthenticated).

Live state: `postgres, redis, event-bus, nats, world-model, memory-subsystem, rtc` all
HEALTHY; `model-gateway` OFFLINE until a Gateway runs with your key.

## Classifications

| Workstream | Result | Basis |
|---|---|---|
| NATIVE_ARM64_ASR | **VERIFIED_LIVE** | Official `whisper-bin-win-cpu-arm64.zip` (tag b5454, 4,371,193 bytes, SHA-256 `28c37e7b…d615ff6d`); every exe/DLL is PE `0xAA64`. |
| REAL_CPU_TRANSCRIPTION | **VERIFIED_LIVE** | Synthetic 8.34 s fixture transcribed accurately through `whisper-cli.exe`; RTF 0.17; 296 MB peak. |
| ADRENO_ACCELERATION | **NOT_ATTEMPTED** | `whisper-bin-win-opencl-adreno-arm64.zip` exists and is downloaded-ready; CPU already meets the target, and OpenCL device support was not verified. |
| AUDIOFRAME_INGESTION | **PARTIAL** | `decodeWav` now turns a 16 kHz WAV into `AudioFrame`s and the adapter consumes real frames; a live capture source is still the sidecar/Windows path. |
| TRANSCRIPT_DELIVERY | **PARTIAL** | `VoiceEngine` → Kernel `asr.final` path unchanged and unexercised with real speech. |
| GATEWAY_READINESS | **BLOCKED_EXTERNAL** | No Gateway process; `7430` closed, `model-gateway OFFLINE`. Restart from your key-bearing shell. |
| RTC_HEALTH | **VERIFIED_LIVE** | `rtc HEALTHY` on the running Kernel after the two fixes above. |
| KOKORO_LOCAL_ASSETS | **NOT_ATTEMPTED** | Requires asset staging plus a worker change; moving it half-way would leave weights on C: and claim otherwise. |
| REAL_SYNTHESIS | **PARTIAL** | System.Speech produced the 16 kHz fixture; Kokoro not exercised. |
| PHYSICAL_MICROPHONE / AUDIBLE_PLAYBACK / FULL_VOICE_CONVERSATION | **NOT_ATTEMPTED** | Yours to perform. |

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

## C — The engine, and what changed

The v1.8.0 x64 binary could not run: it dies in startup CPU dispatch (PE `0x8664` on an
ARMv8 host, exit 1 with no output even for a nonexistent model). That finding stands and is
why the ARM64 asset matters.

The upstream release listing is the trap: the stable tags (`v1.9.4`, `v1.9.5`) carry **zero
assets**; the Windows ARM64 builds live on the nightly tag that each stable release body
links to (`b5454` for v1.9.5). Verified through the GitHub API, then downloaded and checked
byte-for-byte:

| Asset | Size | SHA-256 |
|---|---|---|
| `whisper-bin-win-cpu-arm64.zip` (b5454) | 4,371,193 | `28c37e7b598c3d9bbfef94f3bd67f2ee6f12b7c86f3da5edcf5e4308d615ff6d` |

Installed at `D:\AI\Runtimes\whisper-arm64\Release\` (the old x64 tree is kept at
`D:\AI\Runtimes\whisper` for comparison). `whisper-cli.exe -m … -f … -l en -t 4 -nt -np`
is the supported invocation; the adapter's flags and stdout parsing work unchanged, and
`read_audio_data:` chatter goes to stderr, not into the transcript.

## D — What is still yours to do

1. **Gateway**: start the stack from the PowerShell session holding your key (sequence in
   `docs/JARVIS-GENESIS-LIVE.md` §C); then `model-gateway` goes HEALTHY and text
   conversation works.
2. **Microphone**: press the control and speak. Nothing above used a microphone.

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
