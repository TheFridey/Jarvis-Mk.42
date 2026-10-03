# Voice V2 qualification results

Status on 2026-10-02: **NOT HARDWARE QUALIFIED**. Rhys requested implementation
and a prepared harness, with physical testing later. No invented latency values
or completed acceptance transcript are recorded.

Live non-capture inspection found:

- Microphone Array: Qualcomm Aqstic ACX Static Endpoints Audio Device.
- Speakers: Qualcomm Aqstic Audio Adapter Device.
- System.Speech recognizer: `MS-2057-80-DESK`, `en-GB`.
- Installed System.Speech voices: Microsoft Hazel Desktop and Microsoft Zira
  Desktop. A male British voice is not installed; voice hints fall back.
- OS process architecture: ARM64. Installed Python: x64 3.14.5. No NumPy,
  sounddevice, faster-whisper, Silero, Kokoro or Porcupine package was present.
  No local ASR model path or Porcupine key was configured.

Device presence and recognizer registration prove neither functional capture
nor audible output. Neural inference startup and synthesis remain untested.

| Physical metric or capability | Actual measured result | Status |
| --- | --- | --- |
| Wake latency | Not measured | NOT TESTED |
| ASR latency | Not measured | NOT TESTED |
| Physical interruption latency | Not measured | NOT TESTED |
| Speech-to-audible-response latency | Not measured | NOT TESTED |
| False wake rate | No observation window | NOT TESTED |
| Acoustic self-trigger behaviour | Not observed | NOT TESTED |
| Device loss recovery | Not measured | NOT TESTED |
| Input/output switching | Not physically exercised | NOT TESTED |
| Rhys/Jarvis acceptance interaction | Deferred by operator | NOT TESTED |

Software evidence is recorded in [AUDIT_PROMPT8_VOICE.md](AUDIT_PROMPT8_VOICE.md).
Use [the qualification procedure](VOICE_V2.md#qualification-procedure) to replace
the pending entries with actual measurements and the exact device/runtime setup.
