# Voice architecture — what is connected

```
microphone ──► UtteranceRecorder (capture, pre-roll, VAD)          [existing, tested]
           ──► POST /voice/utterance ──► whisper.cpp (local)       [existing, tested]
           ──► conversation command ──► CompanionService ──► HUMANITY retrieval
           ──► validated answer
           ──► POST /voice/speak/stream ──► KokoroSpeechService    [new this pass]
           ──► NDJSON {index,text,seconds,wav} ──► SpeechPlayback (WebAudio queue)
           ──► speakers + analyser ──► --voice-energy on the Presence layer
```

## New components

| Component | File | Purpose |
|---|---|---|
| `KokoroSpeechService` | `apps/core/src/kernel/voice/kokoro-speech-service.ts` | Warm fp32 session, 90-character chunking, generation-based cancellation |
| `/voice/speak/stream` | `apps/core/src/kernel/diagnostics/http-server.ts` | NDJSON of base64 WAV chunks; abort on client disconnect calls `cancel()` |
| `SpeechPlayback` | `apps/desktop/src/experience/speech-playback.ts` | Sequential WebAudio queue, analyser-driven level, generation-guarded stop |
| `speakStream()` | `apps/desktop/src/experience/scene-client.ts` | Authenticated transport for the stream endpoint |
| STOP SPEAKING + `--voice-energy` | `apps/desktop/src/experience/presence/presence-mode.tsx` | Manual interruption and real audio level for the renderer |

## Design decisions

- **Synthesis in the Kernel, not the browser.** One warm model for the whole machine, not one per tab, and
  no model download on every page load.
- **fp32 over q8** because measurement said so, not because bigger is better.
- **Chunking at 90 characters**: the first chunk is the difference between "a pause" and "silence".
- **Generation guard everywhere.** `stop()` invalidates the generation; the fetch is aborted; queued
  sources are stopped; a chunk arriving afterwards is discarded. This is the only thing that makes
  interruption reliable when synthesis lags playback.
- **No new authority.** Speech neither adds nor removes permissions: the transcript path is the existing
  conversation command, and playback only speaks text the Kernel already validated.

## Not connected yet

- The transcript→command half of the loop is not wired end to end; capture, VAD and transcription exist and
  are tested, but nothing automatically submits a recognised utterance as a conversation turn.
- Automatic barge-in is not implemented. Manual interruption is.
- The orb reads `--voice-energy`; whether the particle renderer visibly responds to it is unverified.
