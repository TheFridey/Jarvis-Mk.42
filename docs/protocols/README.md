# Protocols

Wire-level contracts. These are stable, versioned, and language-neutral so that
non-TypeScript nodes (a future robot controller, an embedded sensor) can speak
them.

| Protocol | File | Purpose |
|---|---|---|
| Event envelope | [`event-envelope.md`](event-envelope.md) | The canonical shape of every event on NATS and in the `events` table. |
| Node Protocol | [`node-protocol.md`](node-protocol.md) | How a device attaches to the Kernel: auth, capability/sensor declaration, heartbeat, scoped subscriptions. The mechanism behind L35–L38. |

The TypeScript source of truth for these shapes is `packages/contracts` and
`packages/protocol`; the docs here are the normative prose + versioning rules.
