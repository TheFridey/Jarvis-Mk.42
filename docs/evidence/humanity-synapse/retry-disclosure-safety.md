# Retry-time disclosure safety

## The risk

`ModelGateway.generate` walks routing candidates: a failed provider is followed by the next with the
same request. For ordinary traffic that is resilience; for a request carrying consented personal
memory it is a second disclosure, made by a component that cannot see consent.

## Implementation (unchanged from the previous pass, now tested)

1. `ModelRequest.disclosure?: 'personal-memory'` — written by the Kernel only. Companion sets
   `memoryBearing` whenever the memory block is non-empty; the orchestrator forwards it.
2. `HttpModelGatewayClient` sends the trusted header `x-jarvis-memory-disclosure`.
3. `ModelGateway.generate` refuses to continue to another candidate and throws
   `retry refused for a personal-memory request`, marked `retryable: false`.

## Behavioural evidence — two loopback providers, real request counts

`apps/gateway/src/retry-disclosure.test.ts` registers two `OpenAICompatibleAdapter`s against two
independent `node:http` servers, each counting what arrives.

| scenario | provider A | provider B | result |
|---|---:|---:|---|
| ordinary request, A fails | 1 | 1 | falls back and succeeds |
| memory-bearing, A succeeds | 1 | 0 | one attempt |
| memory-bearing, A fails | 1 | **0** | throws `retry refused` |
| refusal error | — | — | `retryable: false`, so no outer layer retries |
| cancelled before dispatch | ≤1 | 0 | stops |

No assertion here checks a flag; every one checks a count.

## Remaining retry mechanisms

- **Adapter**: `OpenAICompatibleAdapter` issues exactly one `fetch` per attempt — no internal retry.
- **Transport**: Node `fetch`/undici does not retry by default in this configuration.
- **Provider SDK**: none in use; the adapter speaks HTTP directly.
- **Streaming reconnection**: the gateway client does not reconnect; a broken stream is an error.
- **Kernel/runtime**: `AgentRuntime` does not retry a failed invoke.
- **Outer HTTP caller**: the desktop client surfaces the error; it does not resend the command.

So candidate fallback was the only autonomous retransmission path, and it is closed. That is a
statement about this codebase, not about a provider's own internal retries, which are outside
Jarvis's control.

## Missing or forged metadata

Absence of `disclosure` is treated as unprotected — that is the production contract, because the
Kernel always sets it and the header is added by Kernel code from the marker, never from model output.
A caller that could talk to the gateway directly already holds the shared token, and could also
simply POST the memory itself; the guard protects against the application's *own* fallback, which is
the realistic failure. Documented rather than overstated.

## Boundaries

- Revocation before dispatch: honoured by `verifyBeforeDispatch`.
- Revocation between attempts: protected — there are no further attempts.
- Revocation concurrent with transmission: not prevented.
- Already transmitted: cannot be recalled.
