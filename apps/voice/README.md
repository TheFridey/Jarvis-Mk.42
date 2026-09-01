# apps/voice — realtime audio perception

Runs on the **workstation**. A hard-realtime loop, isolated from the Kernel's
event loop.

## Does

Local VAD → local wake-word detection → local/near ASR → optional diarization +
prosody features. Emits `jarvis.perception.audio.*`, `wake.detected`,
`asr.partial`, `asr.transcript`, `audio.prosody` as **signal-class**
`Observation` events. Debounces/aggregates before emitting.

## Must not (the perception/cognition wall — L7)

- Import `@jarvis/agents`, `@jarvis/context`, the gateway client, or any
  cognition package.
- Call a model for **reasoning** (local perception inference only).
- Draw conclusions ("user is angry") — emit signals ("prosody.arousal=0.8
  conf 0.6").
- Write the World Model or Memory.
- Transmit **raw audio** off-host (L27) — that requires an explicit HIGH-risk
  capability.

## Depends on

`@jarvis/contracts`, a NATS client, local ML runtimes (whisper.cpp / ONNX
Runtime / a wake-word engine). **Not** NestJS.

## Failure behaviour

Sensor loss ⇒ `perception.audio.lost`, continue. NATS down ⇒ bounded local
ring buffer, drop-oldest, gap marker on reconnect. Never crashes the shell or
the Kernel.
