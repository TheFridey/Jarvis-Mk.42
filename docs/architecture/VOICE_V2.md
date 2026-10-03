# Voice V2 and duplex qualification

Voice is a workstation perception process. Core owns identity, RTC sessions,
conversation context, cognition, policy and execution. Python owns local audio
inference only and receives no Kernel credentials or capability interfaces.
Windows `System.Speech` remains the default compatibility adapter.

## Adapter choices

| Stage | Implemented local path | Qualification boundary |
| --- | --- | --- |
| Wake | Porcupine built-in `jarvis`, when an AccessKey is configured; otherwise local ASR phrase matching | Porcupine is a binary detector, so confidence is unknown rather than an invented probability. System.Speech supplies recognition confidence. |
| VAD | Silero, 16 kHz / 512-sample frames | Threshold 0.5; 500 ms endpoint silence; six-frame pre-roll. Requires acoustic tuning. |
| ASR | faster-whisper, local model directory, CPU int8 | Rolling hypotheses at >=650 ms intervals and final transcription. These are repeated local inference passes, not a native token stream. CPU throughput must be measured. |
| TTS | Kokoro British English, configurable voice | Local cached assets and eSpeak NG/G2P prerequisites. No voice quality or hardware latency claim yet. |
| Playback | PortAudio via sounddevice, 20 ms writes | Abort does not wait for synthesis or a Kernel request. Hardware buffering adds latency requiring measurement. |
| Devices | PortAudio inventory and input/output selection | Validate format before switching; restart capture after loss, preserve session and selected devices across sidecar restart. Device indexes can change after OS re-enumeration; explicitly reselect then. |
| Compatibility | System.Speech recognition and synthesis | Windows default endpoints only. `/device default` restarts capture; `/output default` applies the OS output default. Choose other defaults in Windows Settings. |

These choices follow the primary implementations: [Silero](https://github.com/snakers4/silero-vad),
[faster-whisper](https://github.com/SYSTRAN/faster-whisper),
[Kokoro](https://github.com/hexgrad/kokoro), and
[Porcupine](https://github.com/Picovoice/porcupine).
Porcupine requires an [AccessKey](https://picovoice.ai/docs/api/porcupine-python/).
Never paste that key into reports or chat.

`whisper.cpp` is an alternative for native deployment, including its
[streaming microphone example](https://github.com/ggml-org/whisper.cpp/tree/master/examples/stream).
It was evaluated as an alternative; it is not wired into this implementation.
Windows ARM64 wheel availability is a material deployment constraint for the
Python stack. The inspected workstation is ARM64, with an x64 Python 3.14.5
installation. Its neural inference dependencies and models are not provisioned.
Use a separately supported interpreter and validate its native dependencies;
the compatibility path needs no Python.

## Local preparation

From the repository root, with Python 3.11 or 3.12 and the
[eSpeak NG prerequisites](https://github.com/espeak-ng/espeak-ng):

```powershell
./apps/voice/scripts/setup-local.ps1 -PythonPath 'C:/path/to/python.exe'
./.voice-venv/Scripts/python.exe apps/voice/sidecar/provision_models.py --directory .voice-models
$env:JARVIS_VOICE_PYTHON = (Resolve-Path .voice-venv/Scripts/python.exe).Path
$env:JARVIS_ASR_MODEL_PATH = (Resolve-Path .voice-models/asr).Path
$env:HF_HOME = (Resolve-Path .voice-models/hf).Path
$env:JARVIS_VOICE_ADAPTER = 'local'
pnpm voice:preflight
pnpm voice:dev
```

Provisioning is an explicit download operation, separate from listening.
Runtime sets Hugging Face offline mode, requires a local ASR path, and blocks
Python socket connections. Missing cached assets fail startup. Normal local
startup failure falls back to Windows with a static diagnostic. Qualification
mode fails explicitly instead of silently changing the adapter being measured.
Dependencies are in a dedicated ignored venv; model assets are ignored too.
The code has been verified without installing or running those neural models
on this workstation. They remain deployment and inference validation work.

`/devices`, `/device <id>`, `/output <id>`, `/listen`, `/ptt`, `/stop`, `/quit`
control the runtime. `/ptt` is a CLI listening latch, not a hardware hold button.
The adapter interfaces live in `apps/voice/src/adapters.ts`; implementations
are swappable without adding authority to them. The sidecar's Silero, Whisper,
Kokoro and wake classes are separately injectable into its runtime.

## Duplex, privacy and Experience

- Capture/VAD runs independently of the ASR worker and TTS worker. Audio queues
  are bounded: 128 capture frames, four ASR jobs, and a 20-second utterance limit.
  Drops are counted and broken capture segments are not spliced together.
- An ASR hypothesis that differs from the playback reference cancels output
  before awaiting the Kernel's barge-in acknowledgement. Only an adapter with
  qualified AEC can set `echoCancelled` and interrupt on VAD alone. Current
  shipped adapters do not claim AEC. Text overlap and a 700 ms playback tail
  suppress obvious self-triggering; similar user/TTS words can cause missed
  interruptions. This heuristic is mitigation, not full acoustic cancellation.
- Response generations discard stale answers after new speech, deactivation,
  loss or switching. Core holds eight bounded conversation turns per RTC
  session, expires inactive histories after 30 minutes, and rejects stale final
  sequences. Device recovery does not create another conversation.
- Private inherited NDJSON stdio v1 carries commands, acknowledgements and
  allowlisted derived events. No PCM crosses the Kernel boundary. Runtime
  processes do not write raw audio; recognition buffers are RAM-only and
  cleared on stop. The sidecar cannot reach Core or cloud ASR/TTS. No cloud
  audio adapter is enabled: introducing one requires an explicit Kernel policy
  and permission path rather than choosing an arbitrary endpoint in Python.
- Partial/final transcripts are sensitive content, not logs. Existing Kernel
  transcript event retention still applies; this does not promise transcript
  erasure. Derived UI captions clear after 15 seconds. Core only projects fresh
  audio state for three seconds and reconstructs allowlisted values. The
  authenticated Experience transport supplies microphone amplitude, VAD,
  wake confidence where provided, captions, TTS state, playback amplitude and
  device state. The Core animation consumes that projection. Spectral bands
  are not fabricated; Windows playback amplitude is unavailable.
- Static structured logs contain state/component/node and trace identifiers,
  never transcript text, TTS text, raw audio or credentials. Final interactions
  propagate a real trace into Core. Device inventories and qualification
  reports are operator interfaces, not authority.

## Qualification procedure

Run the stack, migrations, Core, configured Model Gateway and live desktop.
Run `pnpm voice:qualify` in another terminal. Leave the desired adapter selected;
the harness never substitutes a fake model response. Use local reasoning models
or the existing explicit Core policy for cloud cognition; audio processing stays
local in either case.

1. Say **“Jarvis.”** Confirm LISTENING. Repeat three times, using `/stop` before
   each wake. Enter `/mark wake PASS` only when this physically works.
2. Ask **“Remember that my chosen colour is blue. Explain why the sky looks
   blue.”** Confirm a partial caption and audible response. Mark `partial` and
   `reply` PASS. Change the prompt if the model responds too briefly to interrupt.
3. During playback say **“Stop. What colour did I choose?”** Confirm rapid
   cessation, the new transcript, and a correct follow-up without another wake.
   Mark `barge-in` and `same-context` PASS. Repeat at different speaker volumes.
4. Let several responses play without speaking. Observe the microphone loop;
   record each unwanted trigger with `/self-trigger`. Mark `self-trigger` PASS
   only after no unintended activation or model request occurs.
5. Physically disconnect and reconnect the selected microphone. Confirm loss,
   recovery and the same conversation. Mark `device-recovery` PASS. Switch input
   and output with the commands above; verify acquisition and audible output
   from the chosen endpoints. Mark `input-switch` and `output-switch` PASS.
6. Run `/baseline start`, observe dormant listening for at least ten minutes
   with ordinary background sound and no intended wake phrases. Enter
   `/false-wake` for each false activation, then `/stop` to return to dormant.
   End with `/baseline stop`. A short zero-event observation is not a reliable
   statistical upper bound on future false wakes.
7. Use `/mark <check> FAIL` for failed checks, `/report` to save, and `/quit`.
   The report remains unqualified unless every check is operator-attested PASS,
   all timing categories have samples, there is a ten-minute baseline and no
   observed self/false triggers. This is functional operator qualification,
   not acoustic latency certification.

Reports contain no speech content or audio. JSON and Markdown are written to
`artifacts/hardware-validation/voice/latest.*`, at the repository root, and
ignored by Git. Copy reviewed non-sensitive measured results into the table in
[VOICE_QUALIFICATION_RESULTS.md](VOICE_QUALIFICATION_RESULTS.md).

| Metric | Host timing definition |
| --- | --- |
| Wake | Dedicated wake event arrival to activation acknowledgement; fallback uses speech-start arrival to acknowledgement. These are distinct boundaries. |
| ASR | Speech-start event arrival to final transcript arrival, including utterance duration and endpointing. |
| Interruption | Accepted speech/hypothesis to playback cancellation acknowledgement; excludes speech detection/inference latency. |
| Response | Speech-start arrival to synthesis/playback-start signal. Includes the utterance and Kernel inference; does not measure acoustic first audible sample. |
| Recovery | Host loss event arrival to capture-ready event arrival. |

For acoustic onset/offset latency, use an external recorder or loopback analyser
with explicit temporary recording consent and a calibration signal. The harness
does not create that recording by default. Keep those measurements separate
from the host timings above; do not relabel host cancellation as physical
interruption latency.
