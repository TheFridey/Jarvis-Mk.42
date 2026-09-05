# Realtime voice

`apps/voice` is a separate Windows workstation process. It owns realtime audio
I/O, activation, recognition and speech playback. Core remains authoritative
for identity, RTC sessions, cognition, modes and audit.

The first adapter uses Windows `System.Speech`: recognition and dormant wake
phrase processing remain local, and no raw audio is written to disk or sent to
a cloud service. The TTS voice is selected independently from reasoning models
requesting a mature male `en-GB` voice and falling back to the closest installed
Windows voice. It does not clone an actor. This workstation currently exposes
British Hazel and US Zira, so installing a suitable British male Windows voice
pack is required to meet the intended voice target here.

Activation options:

- Say “Jarvis” using local recognition.
- Enter `/listen` for a manual listening latch.
- Enter `/ptt` for the development push-to-talk fallback.
- Enter `/stop`, `/device default`, or `/quit` for lifecycle/device control.

Barge-in is always enabled: detected speech aborts the active TTS process and
the next utterance remains attached to the same durable RTC session. Recognition
events are held in a 64-entry drop-oldest buffer. Partial transcripts are
transient events; final transcripts are retained according to event policy.

## Windows first-boot test

1. `pnpm stack:up`
2. `pnpm db:migrate`
3. `pnpm core:dev`
4. In another terminal, configure a local model and run `pnpm gateway:dev`.
   Alternatively explicitly permit configured cloud models with
   `JARVIS_MODEL_CLOUD_ALLOWED=true` on Core.
5. Run the desktop with `pnpm --filter @jarvis/desktop tauri`.
6. Run `pnpm voice:dev`.
7. Say “Jarvis”, or enter `/ptt`, then ask “What time is it?”
8. Ask a follow-up without reactivating. While JARVIS is speaking, begin the
   next utterance and confirm playback stops immediately.

The selected ASR/TTS runtime depends on Windows language and voice packs. CI
tests deterministic audio state machines and Kernel integration only; it does
not certify physical microphones, speakers, acoustic latency, or installed
Windows voice quality.
