# ADR-0012: LiveKit / WebRTC direction (deferred)

Status: Accepted (direction ratified; deployment deferred)
Date: 2026-08-31
Deciders: Principal Architect

## Context
A future multi-device JARVIS needs low-latency realtime media between nodes:
voice from a phone, audio/video to a display node, AR headset streams, and
possibly agent-observed screen shares. WebRTC is the transport for that; an SFU
(Selective Forwarding Unit) like LiveKit is how you scale it past 1:1.
However, MK.42 has exactly one workstation and one local server on a LAN
(adversarial review §16.3) — no media needs to traverse a mesh.

## Decision
Ratify **WebRTC as the realtime-media transport direction** and **LiveKit as
the SFU** for the first multi-device MK. **Do not deploy LiveKit or any SFU in
MK.42.** MK.42 perception captures locally and sends **derived observations**
(not media) to the Kernel over mTLS WebSocket. The seam is preserved because
perception already emits observations, never raw media, across the process
boundary.

## Alternatives considered
- **Deploy LiveKit now** — infrastructure with no consumer; premature (review
  §16.3).
- **Raw WebRTC peer connections, no SFU, indefinitely** — fine for 1:1, breaks
  down for N display/AR nodes; we'd re-architect later.
- **WebSocket audio streaming instead of WebRTC** — simpler, but poor jitter/
  latency characteristics for realtime voice across nodes; acceptable only for
  the single-LAN MK.42 case, which is exactly what we do now.
- **Mediasoup / Janus / Jitsi** — viable SFUs; LiveKit chosen for its
  TypeScript-first SDKs, room/participant model, and agent-framework fit.

## Benefits
- No unused infrastructure in MK.42.
- Clear, ratified target so MK.51+ media work doesn't re-litigate transport.
- Perception's observation-only output means adding media transport later
  doesn't touch the Kernel's contracts.

## Disadvantages
- MK.42's single-LAN media path (direct WebSocket) is throwaway work when
  LiveKit lands — but it is small and the interface (`MediaTransport`) is
  shared.

## Risks
- LiveKit's trajectory changes over the years before we need it. Mitigated:
  the decision is "an SFU, WebRTC" first; LiveKit specifically is
  Low-reversal.

## Consequences
- MK.42: no LiveKit container; `apps/relay` stays an empty seam.
- Perception and Experience media I/O go behind a `MediaTransport` interface
  now, even though the only implementation is direct WebSocket.
- First multi-device MK adds LiveKit to infrastructure + a `MediaTransport`
  LiveKit implementation.

## Reversal difficulty
**Low.** Nothing is built on LiveKit yet. Choosing a different SFU later is an
implementation choice behind `MediaTransport`.
