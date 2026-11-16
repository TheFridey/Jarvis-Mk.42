# Voice baseline — what already exists

Inspected, not assumed. Classifications reflect this pass only.

| Component | Where | Status |
|---|---|---|
| Browser microphone capture | `apps/desktop/src/experience/voice-capture.ts` (`UtteranceRecorder`) | IMPLEMENTED BUT UNVERIFIED — half-duplex push-to-talk, WAV encode, 0.5 s pre-roll |
| Voice activity detection | `apps/desktop/src/experience/voice-vad.ts` | VERIFIED by unit tests — calibrated noise floor, hysteresis, 850 ms end-of-speech, 250 ms voiced, 8 s no-speech |
| Local speech recognition | `packages/speech` (whisper.cpp adapter), `D:/AI/Runtimes/whisper-arm64/Release/whisper-cli.exe`, `ggml-base.en.bin` | VERIFIED — real engine, real fixture transcription |
| Utterance transport | Kernel `/voice/utterance` (`utterance-service.ts`) | VERIFIED by unit tests — 16 kHz mono, 30 s / 960 000 byte ceilings, seven refusal reasons |
| Speech synthesis transport | Kernel `/voice/speak` (`speech-synthesis.ts`), `scripts/system-speak.ps1` | IMPLEMENTED BUT UNVERIFIED end-to-end |
| Installed system voices | Windows SAPI | `Microsoft Hazel Desktop` (en-GB, female), `Microsoft Zira Desktop` (en-US, female). **No British male voice is installed.** |
| Neural local TTS | `kokoro-js` 1.2.1 + `onnxruntime-node` (win32/arm64 present) | VERIFIED this pass — real synthesis, measured below |
| Piper | — | NOT INSTALLED (`piper` absent from PATH) |
| Browser playback | — | PARTIAL: synthesis endpoint returns WAV; nothing in Presence plays it |
| Barge-in / interruption | — | NOT IMPLEMENTED |
| Audio-reactive orb | — | UNVERIFIED: the renderer has state-driven behaviour; whether any of it is bound to real amplitude is not established |
| Continuous voice session | — | NOT IMPLEMENTED: current capture is push-to-talk per utterance |
| LiveKit | `infrastructure/docker/rtc.compose.yml`, RTC env | VERIFIED running (container healthy); no application code path was inspected that routes voice through it |
| Application-only restart | `scripts/jarvis-up.ps1 -RestartApp` | IMPLEMENTED this pass (not yet exercised against a running app) |
| PostgreSQL readiness before migration | `scripts/jarvis-up.ps1` (`pg_isready`, 30 s, fail closed) | IMPLEMENTED this pass |

## What this means

The capture, VAD, recognition and transport layers already exist and are tested. What does not exist is
the *loop*: nothing takes a transcript, submits it as a conversation command, takes the validated answer,
synthesises it and plays it, then returns to listening. Nothing plays audio in the interface at all.
