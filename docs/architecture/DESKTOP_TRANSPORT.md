# Desktop Transport

The desktop is a presentation client. It does not own Kernel mode, health,
identity, sessions, objectives, policy, approvals, capability execution, or
semantic resource truth.

## Live path

`KernelSceneTransport` polls the loopback Kernel desktop gateway for a typed
`DesktopKernelSnapshot`. The snapshot contains authoritative State Manager
slices, diagnostics, active sessions, current agency lifecycle rows, policy
denials, pending approvals, and a semantic scene projected from those values.
The snapshot `stateVersion` is the optimistic concurrency boundary for every
desktop command.

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
- Polling reconnects with bounded exponential backoff.
- A `409 state_version_conflict` refreshes the snapshot and rejects the stale
  command.
- The UI remains running but shows `KERNEL OFFLINE` / `DEGRADED` and an empty
  non-authoritative scene until a valid snapshot arrives.
- A prior snapshot may remain visible during a short reconnect, but the status
  is `RECONNECTING`; it is never labelled synchronised.

## Development configuration

The gateway binds to `127.0.0.1:7420` by default. Development defaults on both
sides use `dev-desktop-token`. Override both together:

```text
JARVIS_DESKTOP_TOKEN=<local-secret>
NEXT_PUBLIC_JARVIS_DESKTOP_TOKEN=<same-local-secret>
NEXT_PUBLIC_JARVIS_CORE_URL=http://127.0.0.1:7420
```

The browser-visible development bearer is suitable only for the loopback
development boundary. Packaged remote/node clients require the future Node
Protocol device identity and mutually authenticated transport; do not expose
this HTTP ingress beyond loopback.

Explicit visual-development mode is available with
`NEXT_PUBLIC_JARVIS_DEMO_MODE=1`. It is labelled `DEMO MODE`, has no Kernel
snapshot, and refuses proposal and approval commands.
