# Node Protocol v1 operations

The Kernel now owns a private TLS 1.3 HTTPS/mTLS WebSocket ingress. It is disabled
unless explicitly configured. Only `127.0.0.1` and `::1` bind addresses are
accepted. Wildcard, public, DNS and LAN binds are rejected in this first rollout.
This is a localhost distributed-process proof, not a claim of two physical
machines, LAN deployment, hardware attestation, or remote actuator qualification.

## Lifecycle and authority

| Stage | Operational path |
| --- | --- |
| ENROLL | `POST /nodes/enroll`: preissued client certificate plus single-use enrollment token |
| AUTHENTICATE | `POST /nodes/authenticate`: certificate/key identity, node ID and expected connection epoch |
| DECLARE | WebSocket `DECLARE` with the existing `NodeDescriptor` contract |
| ADMIT | Kernel returns the existing `NodeAdmission` contract; requested trust never increases enrollment trust |
| SUBSCRIBE | `SUBSCRIBE system-status` returns a deliberately small safe projection |
| HEARTBEAT | Server generates a one-use nonce; the bound node answers it; server monotonic time measures RTT |
| OPERATE | Admitted `runtime-health` observation, through EventManager validation and transactional outbox |
| ROTATE | Preissued replacement certificate, same node identity, new key and signed proof of possession |
| REVOKE | Loopback local operator endpoint; registry revocation cascades to credentials and closes the channel |
| DISCONNECT | Explicit frame, transport loss or heartbeat timeout ends attachment and device session |
| RECONNECT | Fresh certificate authentication, new epoch/session/credential; operation IDs retain durable receipts |

Certificates have a single URI SAN `urn:jarvis:node:<nodeId>`, client-auth EKU and
a seven-day validity in the supplied provisioning tool. Kernel binds the
certificate's SPKI SHA-256 fingerprint to the persisted node record. The issuing
CA must be trusted by the TLS listener. An enrollment token alone is insufficient.
Signing the replacement connection-bound rotation challenge proves possession of
the new private key. Rotation has zero old-key overlap on the network ingress:
old certificates and old access credentials stop working immediately. The older
library overlap option remains available to existing internal callers.

Enrollment tokens expire within five minutes and are consumed atomically. Access
credentials expire after fifteen minutes, bind identity/principal/node/session,
and have only node scopes. Authentication rotates them on reconnect. Every frame
checks the live credential, certificate-bound node, persisted epoch/session,
strictly increasing per-connection sequence, and terminal registry state. Old
connections cannot disconnect a newer epoch. Startup fences abandoned attachment
epochs, and authenticated clients that never attach time out too.

The supplied runtime uses exponential reconnect backoff and mTLS `/nodes/status`
to resynchronize after server loss. It subscribes again after admission. It stops
retrying when the server blocks the device. It does not automatically replay an
operation. Callers retry with the **same operation ID and same content**.
Receipt, validated event and outbox entry commit in one PostgreSQL transaction;
changed content for an existing ID is rejected. Receipts survive ingress restart
and are retained for the node's lifetime. This prevents duplicate admission-side
effects; the event fabric still has its existing at-least-once delivery semantics.

## Trust and data boundaries

`kernel-local` remains reserved for the composition root. Remote requests cannot
ask for it. Enrollment clamps `owned-secure`, `owned-mobile` and `guest` to the
operator's token ceiling; subsequent declarations requesting a higher tier are
rejected. Guest display nodes can read status, but cannot publish observations.
Owned-secure nodes may declare and publish the bounded boolean `runtime-health`
sensor. Owned-mobile observation routes (presence/location/voice intent) are not
implemented on this transport and remain denied, respecting their narrower ceiling.
All declared capabilities are currently denied: remote adapter hosting and
world-affecting operations are not admitted by this initial transport. Normal
Agency policy, permission, approval, executor and verification boundaries retain
their authority. A capability declaration is never a permission grant.

The status projection contains only protocol version, Kernel mode, overall health,
and the authenticated node's availability/RTT. It does not expose state slices,
approvals, transcripts, credentials, raw audio, frames or other nodes' private data.
Observed runtime events carry the **authenticated source node**, node actor and
untrusted sensor provenance. Arbitrary event envelopes are rejected on the wire.
Node availability updates registry presence and the noncritical node health
subsystem. Network reachability does not imply the operator is physically present.

TLS requests and WebSocket messages are bounded; compression is disabled; slow
consumers and excessive in-flight messages are disconnected. Liveness checks do
not overlap. Rejections carry only fixed safe reason codes. Secret tokens and key
material are not logged or passed as command-line arguments. Grafana and the
telemetry stack have no role in node authority.

## Operator setup

Run migrations using the existing database migration workflow. Provision a private
directory, with per-node certificates, on the operator machine:

```powershell
pnpm node:pki .node-pki workstation-1 display-1 workstation-1-rotated
```

The tool refuses a nonempty directory, applies a private Windows ACL (or Unix
permissions), and generates unique certificate serials and separate EC keys.
`workstation-1-rotated` is a second key/certificate for `workstation-1`, for rotation.
The generated CA key belongs offline with the operator. Give Kernel only
`ca.crt`, `server.crt`, `server.key`; give each device only its own key/certificate
and the CA certificate. Do not copy the complete PKI directory to a device.

```powershell
$env:JARVIS_NODE_INGRESS_ENABLED = '1'
$env:JARVIS_NODE_HOST = '127.0.0.1'
$env:JARVIS_NODE_PORT = '7425'
$env:JARVIS_NODE_CA_FILE = (Resolve-Path .node-pki/ca.crt).Path
$env:JARVIS_NODE_CERT_FILE = (Resolve-Path .node-pki/server.crt).Path
$env:JARVIS_NODE_KEY_FILE = (Resolve-Path .node-pki/server.key).Path
pnpm core:dev
```

Authenticate the existing loopback operator `/auth/session` endpoint with scope
`nodes.manage`. Using that session's bearer token plus `x-jarvis-node-id` and
`x-jarvis-session-id`, call `POST /nodes/enrollments` with
`{"trustCeiling":"owned-secure","ttlMs":300000}`. Save its token directly into a
private file without printing it. The operator must be the bootstrap principal
on the composition-root `kernel-local` node; remote node scopes cannot administer
enrollment or revocation. `POST /nodes/revoke` accepts `{"nodeId":"workstation-1"}`.

A private runtime profile references files instead of embedding secrets:

```json
{
  "endpoint": "https://127.0.0.1:7425",
  "caFile": "C:/private-node/ca.crt",
  "certFile": "C:/private-node/workstation-1.crt",
  "keyFile": "C:/private-node/workstation-1.key",
  "tokenFile": "C:/private-node/enrollment.token",
  "descriptor": {
    "nodeId": "workstation-1", "nodeType": "workstation", "protocolVersion": "1",
    "sensors": ["runtime-health"], "capabilities": [],
    "surfaces": ["status-display"], "requestedTrustTier": "owned-secure",
    "attributes": {}
  }
}
```

Set `JARVIS_NODE_PROFILE_FILE` to that profile and run `pnpm node:runtime`. A
display profile uses `nodeType: display`, `requestedTrustTier: guest` and no
sensors. The simple display runtime renders the safe status stream as JSON on
stdout. Keys and access tokens remain inside the runtime. After enrollment,
remove `tokenFile` from the profile and securely discard the consumed token file.
The typed `NodeClient.rotate(certificatePem, privateKey)` API performs key rotation
and switches its TLS identity only after a successful server acknowledgement;
persist the replacement certificate/key paths in the device profile for restart.
The runtime does not automatically renew certificates or rotate offline CA keys.

## Reproducible proof

```powershell
pnpm node:proof
```

This gate fails if Docker is unavailable. It provisions disposable private PKI
and PostgreSQL, starts the real Kernel listener with a real clock, and launches
separate workstation and display Node.js processes. It also launches the normal
profile-driven CLI to prove automatic subscription/reconnect and the operator
HTTP enrollment/revocation endpoints. Communication is real TLS/WebSocket traffic,
not an in-memory transport. The existing in-process event bus is used in this
proof; it does not certify a NATS deployment.

The suite attacks enrollment replay/expiry, forged identity, trust escalation,
heartbeat spoofing, wrong sessions/scopes, sequence replay, unadmitted sensors,
stolen old credentials, expired credentials, revoked nodes, changed duplicate
operations and stale reconnect epochs. It proves liveness expiry, attachment
timeout and durable operation deduplication across network-server restart.
Safe process IDs, measured heartbeat RTT and lifecycle evidence are written to
ignored `artifacts/node-protocol/latest.json`; no credentials or raw content enter
that artifact. See the checked-in verification record for the actual run results.
