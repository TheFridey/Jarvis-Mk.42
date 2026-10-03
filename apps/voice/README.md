# Voice V2

Voice owns local perception and playback. Core owns identity, policy, RTC
sessions, cognition and bounded conversation context. Windows `System.Speech`
remains the default compatibility adapter.

- `pnpm voice:dev`: Windows fallback, or the configured local adapter.
- `pnpm voice:preflight`: dependency/recognizer inventory; no hardware claim.
- `pnpm voice:qualify`: real operator qualification, with content-free measured
  host timings and manual checks. Requires Core and a configured Model Gateway.
- `/listen`, `/ptt`, `/stop`, `/devices`, `/device <id>`, `/output <id>`, `/quit`.

The opt-in Python sidecar uses Silero VAD, faster-whisper, Kokoro and optional
Porcupine. It requires separately provisioned local assets and supported native
dependencies. It has private typed stdio, no Kernel credentials, no cloud audio
path, and no raw-audio persistence.

Barge-in cancels playback on a confirmed non-echo hypothesis. VAD-only
interruption is reserved for a qualified AEC adapter; current adapters do not
claim acoustic echo cancellation. Follow-up, switching, and recovery retain the
same RTC context. Stale model replies cannot resume cancelled playback.

See [setup, architecture and qualification](../../docs/architecture/VOICE_V2.md)
and [actual qualification results](../../docs/architecture/VOICE_QUALIFICATION_RESULTS.md).
Physical testing is deferred; neural inference has not been run on this ARM64
workstation. Installed Windows voices are Hazel and Zira, so a British male
voice is not currently available.
