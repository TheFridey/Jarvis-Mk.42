# Latency and performance

| Stage | Measured | Target | Verdict |
|---|---|---|---|
| Model load, cold | 28.5 s (fp32) | warm at startup | MET by a persistent Kernel session |
| Synthesis, warm | RTF 0.94–1.05 | ≤ 0.5 | **NOT MET** |
| Time to first chunk | 4.5 s for a 9.4 s answer | 1–2 s | **NOT MET** |
| Cancellation | immediate (generation + abort) | < 150 ms | MET by construction, not timed |
| VAD end-of-speech | 850 ms configurable | 500–900 ms | MET (existing, tested) |
| whisper.cpp transcription | ~1.45 s for 8.3 s audio | < 1.5 s | MET (existing) |

Peak RSS with the model resident: ~541 MB (fp32). CPU: single Node process, ONNX runtime default threads;
no GPU or NPU acceleration, and none claimed.

## What this means for conversation

The first sentence of an answer is audible roughly 4–5 seconds after the answer is validated, and the rest
follows while it plays. That is a usable cadence for a desktop assistant and a poor one for a phone call.
Improving it needs either a faster engine on this hardware (Piper arm64, unproven) or NPU execution via
Windows ML (not available through the Node binding). Neither is attempted here.
