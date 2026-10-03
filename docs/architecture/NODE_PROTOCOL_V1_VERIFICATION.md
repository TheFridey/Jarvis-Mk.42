# Node Protocol v1 verification — 2026-10-02

The real private network suite passed **18/18 tests**. It ran the Kernel server
and separate workstation/display Node.js processes using newly generated EC keys,
CA-signed client certificates, TLS 1.3 and real WebSocket traffic. PostgreSQL was
disposable Docker infrastructure. Kernel used a real clock. No mock transport or
static shared node token was used.

## Recorded lifecycle evidence

The successful lifecycle artifact was measured at **2026-10-02T16:29:44.600Z**.

| Evidence | Actual result |
| --- | --- |
| Bind | `127.0.0.1`, private mTLS WebSocket |
| Kernel process | PID `10704` |
| Workstation process | PID `8204` |
| Display process | PID `20396` |
| First authenticated heartbeat challenge RTT | `145.225 ms` |
| Reconnect epoch | `2` |
| New-key rotation/reconnect epoch | `3` |
| Observation event | `01M3YQ6B2R9X0GX3SCD69285RS` |
| Certified event source | `workstation-1` |
| Events after same-ID reconnect replay | Exactly `1`; cached original event ID returned |
| Revoked and stale key/credential access | Rejected |
| Physical hosts | `1`; multiple actual runtime processes |

The RTT is a single measured authenticated challenge/response elapsed interval,
including initial admission and ingress processing. It is not a network-only RTT,
hardware benchmark, percentile or latency guarantee. Later heartbeats continue
measuring real elapsed time. The safe raw artifact is generated at
`artifacts/node-protocol/latest.json` and is ignored by Git.

The independent normal runtime profile also enrolled through the loopback operator
API, subscribed automatically, reconnected and resubscribed after ingress restart,
then stopped reconnecting after operator revocation. The display proof rendered
the safe derived status stream, not a full workstation desktop.

## Attack and recovery coverage

The suite exercised enrollment-token replay/expiry, certificate/node-ID mismatch,
forged frame node identity, trust escalation, wrong session, wrong scope, revoked
nodes, stolen old access credentials presented with a valid device certificate,
expired access credentials, heartbeat nonce spoofing, sequence replay, stale
reconnect epochs, unadmitted observations, the owned-mobile observation ceiling,
changed content under a duplicate operation ID, and replacement-key rotation
without proof of possession. Each attack was rejected. A certificate-free TLS
client was rejected before reaching the application.

Liveness loss updates node registry availability and its noncritical health entry.
Authenticated nodes that never attach a socket time out and lose credential
validity. Same-content operation retries return one durable receipt/event after
both reconnect and network-server restart. Registry writes use version checks so
stale liveness writes cannot overwrite revocation or key rotation.

## Checks and limits

- Typecheck and structural lint passed.
- Unit suite: **315 passed**; final focused node/credential tests: **11 passed**.
- Contract gate: **16 passed**.
- Security gate: **30 passed**.
- Architecture fitness gate: **17 passed**.
- Private Node Protocol integration suite: **18 passed**.
- Independent Kernel lifecycle regression suite: **9 passed**.

The additional Kernel lifecycle regression suite initially timed out during its
fixture setup without executing tests. Its independent rerun passed all nine
tests (266.46 seconds), including restart recovery, degradation/recovery and
authenticated desktop ingress. The initial timeout was not counted as a pass.

Reproduce the dedicated network proof with `pnpm node:proof`. Docker absence fails
the command instead of producing a skipped success. The wider `verify:full`, NATS
transport fault injection, chaos, backup/restore and desktop release build were
not rerun for this change. This is not a production release certificate.

No public endpoint was exposed. LAN/two-machine deployment, mobile sensor routing,
remote adapter hosting, hardware attestation, and automatic certificate/CA renewal
are not claimed. Earlier architecture audit documents retain their historical
findings; current operational boundaries are in
[the operations guide](NODE_PROTOCOL_V1_OPERATIONS.md).

All proof processes and disposable containers were stopped. Two temporary PKI
folders from interrupted debug runs remain under the operator's user Temp
directory: `jarvis-node-proof-IDI3zS` and `jarvis-node-proof-WTcFB8`. Automatic
approval review rejected both recursive and individual-file cleanup with
"blocked by policy". These certificates belonged only to removed disposable
servers; no current listener trusts their CA. No production credentials are in
these folders.
