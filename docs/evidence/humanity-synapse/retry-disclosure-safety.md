# Retry and disclosure safety - wire evidence

## Counted on real sockets

`apps/core/src/kernel/cognition/agent-runtime-wire.test.ts` puts a real HTTP server behind the real
`HttpModelGatewayClient` and counts arrivals:

| scenario | arrivals | disclosure header |
|---|---:|---|
| protected, malformed proposals | **1** | `1` |
| unprotected, malformed proposals | **2** (one repair) | `0`, `0` |
| protected, provider 500 | **1** | `1` |
| protected, requested allowance 6144 | 1 | - (`max_tokens` 6144 observed) |

`apps/gateway/src/truncation.test.ts` proves the adapter's truncation classification on the wire:
`finish_reason: 'length'` becomes `INVALID_RESPONSE` after exactly one arrival.

## What each layer guarantees

| path | protected request |
|---|---|
| Gateway candidate fallback | refused (`request.disclosure` read from the header now) |
| AgentRuntime format repair | refused; classified error names the refusal |
| HTTP transport retry in the adapter | none exists |
| streaming reconnection | none exists |
| browser auth retry on 401 | before execution, no model call |
| job recovery / lease resumption | same classification, no new inference without a new request |
| 409 cancellation | no retry; the interface distinguishes it from a state conflict |

## Residual limitations, unchanged

- A caller holding the Gateway token can send `0`. Fail-safe now covers a missing marker, not a lie.
- Revocation cannot remove personal facts from turns already stored in a conversation.
- No atomicity across the socket is claimed, and no transaction is held across inference.
