# @jarvis/protocol

**Purpose.** Wire-level framing shared by every process and node: the `Event`
envelope encoder/decoder and validation hook, and the Node Protocol handshake
(CONNECT → AUTHENTICATE → DECLARE → ADMIT → HEARTBEAT) state machine types.

**Owns.** Nothing persistent. The canonical codec + protocol version
negotiation.

**Depends on.** `@jarvis/contracts` only.

**Must not.** Contain transport specifics beyond an interface (NATS vs
WebSocket is chosen by the host); contain trust/policy decisions (that is the
Kernel's Presence Manager + Policy Engine at ADMIT time).

**Normative prose.** `docs/protocols/event-envelope.md`,
`docs/protocols/node-protocol.md`.

**Extraction seam.** n/a — shared library; travels with whoever speaks the
wire.
