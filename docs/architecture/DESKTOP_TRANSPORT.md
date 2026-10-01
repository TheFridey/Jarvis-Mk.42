# Desktop Transport

The desktop is a presentation client. It does not own Kernel mode, health,
identity, sessions, objectives, policy, approvals, capability execution, or
semantic resource truth.

## Live path

`KernelSceneTransport` obtains one authenticated `JarvisOperatingPicture`
snapshot for bootstrap, then subscribes to the versioned Experience WebSocket
stream. The picture contains authoritative State Manager slices, diagnostics,
active sessions, current cognition and agency lifecycle rows, policy denials,
pending approvals, and the Semantic Scene projected from those values. The
snapshot endpoint remains a recovery and diagnostics fallback; it is not the
normal update loop. `stateVersion` is the optimistic concurrency boundary for
every desktop command and `sceneVersion` guards the embedded semantic scene.

The read-only Experience Projection is an ephemeral projection inside the
existing Kernel process, not a Kernel authority component or a durable event
store. Event Manager append notifications invalidate relevant projection
channels after persistence. Clients subscribe with a session-bound credential
and the explicit `experience.read` scope. Each stream instance has an id and a
bounded sequence history for resume; an unavailable position requires a fresh
snapshot.

The only effect-producing command is a `CapabilityInvocationProposal`. The
gateway derives the active principal from Kernel state and submits the proposal
to `AgencyIngress`; the desktop cannot address an adapter or Executor.

Approval decisions carry the approval id, invocation id, nonce, approval
version, and expected Kernel state version. The Kernel re-reads the durable
approval and resumes the persisted, already-hashed proposal. Desktop-supplied
replacement arguments are not accepted.

Spatial moves, sizing, focus and pinning are presentation state. They remain in
the local layout cache and are overlaid only onto matching objects from each
new Kernel scene. They cannot change authoritative state.

## Failure behaviour

- Commands are rejected while disconnected; they are never queued for later
  side-effecting replay.
- WebSocket reconnect uses bounded exponential backoff and presents the last
  applied stream position for replay where it remains available.
- Heartbeats revalidate the credential and detect dead peers. Revocation and
  logout disconnect the matching session; slow consumers are disconnected
  instead of accumulating an unbounded queue.
- A `409 state_version_conflict` refreshes the snapshot and rejects the stale
  command.
- The UI remains running but shows `DISCONNECTED · DATA STALE`, `RECONNECTING ·
  DATA STALE`, or `DEGRADED`. A prior snapshot may remain visible during a
  reconnect, but it is frozen and never labelled live.

## Development configuration

The gateway binds to `127.0.0.1:7420` by default. Local development may use the
explicit bootstrap default only on loopback. Override the bootstrap credential
for any non-loopback ingress:

```text
JARVIS_BOOTSTRAP_CREDENTIAL=<local-secret>
NEXT_PUBLIC_JARVIS_BOOTSTRAP_CREDENTIAL=<same-local-secret>
NEXT_PUBLIC_JARVIS_CORE_URL=http://127.0.0.1:7420
```

The browser-visible development bearer is suitable only for the loopback
development boundary. Packaged remote/node clients require the future Node
Protocol device identity and mutually authenticated transport; do not expose
this HTTP ingress beyond loopback.

Explicit visual-development mode is available with
`NEXT_PUBLIC_JARVIS_DEMO_MODE=1`. It is labelled `DEMO MODE`, has no Kernel
snapshot, and refuses proposal and approval commands.
