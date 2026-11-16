# TTS evaluation and performance qualification

Owner's decision: **`bm_george`** is Jarvis's provisional voice. `bm_lewis` and `bm_fable` remain
selectable via `JARVIS_TTS_VOICE`; no further voice-identity work is planned.

## Engine

Kokoro-82M (`onnx-community/Kokoro-82M-v1.0-ONNX`) through `kokoro-js` 1.2.1 on `onnxruntime-node`
1.21.0, which ships a `win32/arm64` binary — verified present and loading on this workstation. Apache-2.0
model; voices from a permissively licensed dataset. Entirely local: no text leaves the machine.

## Precision: the counter-intuitive result

Same scripts, same voice, warm runs, measured with `scripts/voice-bench.ts`:

| Precision | Load | Warm RTF | Notes |
|---|---:|---:|---|
| `q8` (quantised) | 7.8 s | **2.28** | 41.6 s of synthesis for 18.2 s of speech |
| `fp32` | 29.7 s | **1.05** | 19.0 s of synthesis for 18.1 s of speech |

The quantised build is twice as slow on this CPU. The int8 kernels are evidently not optimised for this
ARM64 core, so the smaller model loses more in throughput than it gains in memory. **fp32 is the
production choice**; peak RSS 541 MB against 319 MB, which this workstation can afford.

## Chunking

A whole-answer synthesis at RTF ~1 means seconds of silence before the first sound. Answers are therefore
spoken in chunks of at most **90 characters**, split at sentence boundaries and, for long sentences, at
commas — so a boundary is always a natural pause and no chunk is a slow outlier.

Measured through the production service (`scripts/voice-service-proof.ts`, 9.4 s answer):

| Metric | Value |
|---|---|
| Model load (cold) | 28.5 s |
| Time to first chunk | **4.5 s** for 3.8 s of audio |
| Total | 12.3 s for 9.4 s of speech (RTF 1.31, including post-load cold caches) |
| Warm steady state (bench) | RTF 0.94–1.05 |
| Cancellation | abort at chunk 0 → exactly one chunk delivered, none after |

## Hardware acceleration

Not used, and not claimed. `onnxruntime-node` exposes only the CPU provider through the Node binding;
Windows ML and the QNN execution provider are not wired to it, and installing NPU drivers or converting
Kokoro's graph is explicitly out of scope without owner authorisation. Everything above is CPU.

## Honest limitation

**RTF is at best ~1.0, so synthesis only just keeps up with playback.** A long answer will occasionally
under-run between chunks. The mitigation is the queue in `SpeechPlayback` (chunk n+1 is synthesised while
n plays) plus the 90-character cap; it is not a fix for a machine that is synthesising at the speed it
plays. Targets of "first audio under one second" and "RTF ≤ 0.5" are **not met** on this hardware.
