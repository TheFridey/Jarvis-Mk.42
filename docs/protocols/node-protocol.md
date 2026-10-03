# Protocol: Node Protocol (v1 draft)

**Operational update, 2026-10-02:** An opt-in, loopback-only mTLS HTTPS/WebSocket
implementation is exercised with separate workstation/display runtimes. The
implemented wire schema/client are under `apps/core/src/kernel/nodes/`, and use
the existing descriptor/admission/registry contracts. See
[the operations guide](../architecture/NODE_PROTOCOL_V1_OPERATIONS.md) for the
actual ENROLL through RECONNECT lifecycle, permitted subscriptions/observations,
certificate provisioning and executable proof. The broader admission, remote
adapter hosting, Redis liveness and version-negotiation statements below describe
the design target; they are not additional runtime verification claims.

How any device attaches to JARVIS. This is the mechanism that makes L34–L38
("must support future multi-user / multi-device / AR / robotics") structural
rather than aspirational: a new device is a new **node type** speaking this
protocol, not a Kernel change.

TypeScript types: `packages/protocol` + `packages/contracts/src/node.ts`.
Transport: mTLS WebSocket, or NATS with per-node credentials, terminated at the
Kernel directly (MK.42) or at `apps/relay` (future off-LAN nodes).

## Lifecycle

```
1. CONNECT        node opens an mTLS channel to the Kernel / relay
2. AUTHENTICATE   node presents its client certificate + node id;
                  Kernel verifies against the node registry (Presence Manager)
3. DECLARE        node sends a NodeDescriptor:
                    - nodeId, nodeType ("workstation" | "server" | "mobile"
                      | "display" | "gpu" | "ar" | "robot" | ...)
                    - protocolVersion
                    - sensors[]      (observation types it can emit)
                    - capabilities[] (capability manifests it can host)
                    - surfaces[]     (Experience surfaces it presents)
                    - requestedTrustTier
4. ADMIT          operator-configured policy assigns the effective trust tier
                  (kernel-local | owned-secure | owned-mobile | guest);
                  a node cannot self-upgrade. Kernel returns the granted
                  subscriptions + capability scopes for that tier.
5. HEARTBEAT      node sends heartbeats at the negotiated interval;
                  Presence Manager tracks liveness (Redis).
                  Missed beats -> node.heartbeat_missed -> node.unavailable.
6. OPERATE        node publishes Observation events (only its declared types,
                  only on its scoped subjects) and/or hosts capability
                  adapters invoked by the Executor, and/or renders surfaces
                  from scoped read models.
7. DISCONNECT     clean close drains leases; unclean close is handled as
                  node loss (FAILURE_MODEL.md §Node disappears).
```

## Trust tiers (see `SECURITY_MODEL.md` §6)

| Tier | Observations accepted | Capability scopes | Example |
|---|---|---|---|
| `kernel-local` | all | all (policy still applies) | the local server |
| `owned-secure` | all | up to HIGH; CRITICAL needs dual control at Kernel | the workstation, a trusted AR headset |
| `owned-mobile` | presence, location, voice intent | LOW/MEDIUM; HIGH only with live approval elsewhere | the principal's phone |
| `guest` | none (opt-in per session) | AMBIENT presentation surface only | a visitor's laptop, a shared TV |

## What the protocol guarantees

- A node can emit **only** its declared observation types, on **only** its
  scoped subjects, at **only** its trust tier's risk ceiling.
- A node hosting a capability adapter still routes every invocation through the
  Kernel's Executor pipeline — hosting ≠ authority.
- The Kernel admits a node **without code changes**: `nodeType`, sensors, and
  capabilities are data; an unknown `nodeType` with a supported
  `protocolVersion` is admitted at the operator-assigned tier.
- A new physical class (e.g. robotics) that needs new message kinds bumps
  `protocolVersion` and negotiates; older nodes are unaffected.

## Versioning

`protocolVersion` is negotiated at DECLARE. The Kernel supports a rolling
window of versions. New capabilities/observation types do **not** bump the
protocol version — only changes to the lifecycle or message framing do.
