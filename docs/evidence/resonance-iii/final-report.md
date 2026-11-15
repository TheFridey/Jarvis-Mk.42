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
