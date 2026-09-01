# apps/vision — realtime vision perception

Runs on the **workstation**. Hard-realtime loop; GPU/native dependencies;
isolated from the Kernel.

## Does

Local CV: face/person **presence**, hands (MediaPipe), pose, gaze estimate
(future), object/scene tags. Emits `jarvis.perception.vision.*`,
`hands.gesture`, `pose.state`, `gaze.target` (future) as **signal-class**
`Observation` events.

## Must not (L7, L27)

- **Never transmit raw frames off-host.** It emits derived observations only.
  Sending a specific frame to a cloud vision model is an explicit HIGH-risk
  capability invocation, per-instance, policy-gated, audited.
- Import cognition packages or the gateway client.
- Conclude or interpret beyond thresholded signals.
- Write the World Model or Memory.

## Depends on

`@jarvis/contracts`, a NATS client, local CV runtimes (MediaPipe / ONNX
Runtime). **Not** NestJS.

## Failure behaviour

Camera loss ⇒ `perception.vision.lost`, continue. GPU unavailable ⇒ fall back
to lighter model / CPU, else `perception.vision.unavailable`; other streams
continue. Never crashes the shell or the Kernel.
