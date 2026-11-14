# Retry-time disclosure safety

## The risk

The gateway's `generate` walks routing candidates: if one provider fails, it tries the next with the
same request. For ordinary traffic that is resilience. For a request carrying consented personal
memory it is a **second disclosure**, made after the Kernel's authorisation check, by a component
that cannot see consent.

## What was built (narrow, fail-closed)

1. `ModelRequest.disclosure?: 'personal-memory'` — set by the Kernel only. Companion sets
   `memoryBearing` whenever the memory block is non-empty; the orchestrator forwards it into the
   runtime request.
2. `HttpModelGatewayClient` sends the trusted header `x-jarvis-memory-disclosure: 1` when the marker
   is present. Headers are not model-influenced.
3. `ModelGateway.generate` refuses to continue to another candidate when
   `request.disclosure === 'personal-memory'`: it marks the attempt failed, emits routing
   observability, and throws *retry refused for a personal-memory request*.

Ordinary requests keep their fallback behaviour — that path is untouched.

## Guarantees, ordered

| moment | guarantee |
|---|---|
| Before first dispatch | Kernel evaluates grant, consent, classification, provider binding |
| Between attempts | **Protected**: a memory-bearing request cannot fall back to a second provider |
| Concurrent with transmission | Not prevented; nothing atomic is claimed |
| After transmission | Nothing can be recalled |
| Non-memory requests | Fallback permitted, unchanged |

Model *retries inside a single adapter* are also single-attempt: the adapter issues one fetch.

## What is not proven

I could not get a faithful unit harness for the gateway guard — my fixture registration did not
satisfy the registry contract, and rather than ship a test that asserted a flag, I removed it. The
guard is small, reviewable and type-checked; it is **not** covered by an automated test yet, and that
is stated rather than hidden. The next step is a two-candidate fixture driven through
`ModelGateway.generate` with a synthetic principal.

## Limits

- The gateway trusts the header from its own Kernel on loopback with a shared token; it is not a
  cryptographic attestation.
- A provider that retries internally on its own side is outside Jarvis's control.
